// ==UserScript==
// @name         Multi-Site Media Downloader
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Download images and videos from tags on Rule34, Gelbooru, and Danbooru
// @author       shadybrady
// @match        https://rule34.xxx/*
// @match        https://danbooru.donmai.us/*
// @match        https://gelbooru.com/*
// @downloadURL  https://raw.githubusercontent.com/shadybrady101/R34-Danbooru-media-downloader/main/Downloader%20Script.js
// @updateURL    https://raw.githubusercontent.com/shadybrady101/R34-Danbooru-media-downloader/main/Downloader%20Script.js
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    console.log('Script activated on:', window.location.hostname);

    const MAX_PER_PAGE = 100;
    const BATCH_SIZE = 500; // Number of entries to save in a single batch
    const LOCAL_STORAGE_KEY = 'downloadedMedia';
    const MAX_API_RETRIES = 3;

    let totalMedia = 0;
    let downloadedMedia = 0;
    let failedDownloads = 0;
    let skippedMedia = 0;
    let progressContainer;
    let stopRequested = false;

    const downloadedMediaSet = new Set(
        JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]')
    );
    const inProgressDownloads = new Set();
    const newlySkippedSet = new Set();

    const presetTags = [
        { label: 'Videos', tags: '( video ~ vid ~ webm )' },
        { label: 'No AI', tags: '-ai_generated -stable_diffusion -ai_created -aigenerated -ai-generated' },
    ];

    function createUIContainer() {
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 1000;
            padding: 8px;
            background-color: #1e1e1e;
            color: #f0f0f0;
            border: 1px solid #555;
            border-radius: 6px;
            width: 260px;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
            font-family: Arial, sans-serif;
            font-size: 13px;
        `;

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap;';

        const tagInput = document.createElement('input');
        tagInput.type = 'text';
        tagInput.placeholder = 'Enter tags...';
        tagInput.style.cssText = 'width: 100%; padding: 4px; font-size: 13px; margin-bottom: 4px;';

        const scoreInput = document.createElement('input');
        scoreInput.type = 'number';
        scoreInput.placeholder = 'Min score - 0';
        scoreInput.style.cssText = 'width: 100%; padding: 4px; font-size: 13px; margin-bottom: 4px;';

        const downloadButton = document.createElement('button');
        downloadButton.innerText = 'Download';
        downloadButton.style.cssText = getButtonStyles('#4CAF50');
        downloadButton.addEventListener('click', () => {
            const tags = tagInput.value.trim();
            const score = parseInt(scoreInput.value, 10) || 0;
            if (tags) {
                stopRequested = false;
                startMassDownload(tags, score);
            } else {
                alert('Please enter at least one tag.');
            }
        });

        const stopButton = document.createElement('button');
        stopButton.innerText = 'Stop';
        stopButton.style.cssText = getButtonStyles('#F44336');
        stopButton.addEventListener('click', () => {
            if (confirm('Stop all processes?')) {
                stopRequested = true;
                alert('Stopping downloads. This may take a moment.');
            }
        });

        const resetButton = document.createElement('button');
        resetButton.innerText = 'Reset Skipped';
        resetButton.style.cssText = getButtonStyles('#FFC107');
        resetButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to reset skipped tracking?')) {
                downloadedMediaSet.clear();
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([...downloadedMediaSet]));
                alert('Skipped tracking has been reset.');
            }
        });

        const presetContainer = document.createElement('div');
        presetContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;';
        presetTags.forEach(preset => {
            const btn = document.createElement('button');
            btn.innerText = preset.label;
            btn.style.cssText = getButtonStyles('#2196F3') + 'flex: none; padding: 2px 6px;';
            btn.addEventListener('click', () => {
                const currentTags = tagInput.value.trim();
                const newTags = preset.tags;
                const mergedTags = currentTags ? `${currentTags} ${newTags}` : newTags;
                tagInput.value = mergedTags.trim();
            });
            presetContainer.appendChild(btn);
        });

        container.appendChild(tagInput);
        container.appendChild(scoreInput);
        container.appendChild(presetContainer);
        buttonContainer.appendChild(downloadButton);
        buttonContainer.appendChild(stopButton);
        buttonContainer.appendChild(resetButton);

        progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            background-color: #2e2e2e;
            padding: 8px;
            border-radius: 4px;
            font-size: 12px;
            text-align: left;
        `;
        progressContainer.innerHTML = `
            <strong>Progress:</strong> 0%<br>
            <strong>Downloaded:</strong> 0<br>
            <strong>Failed:</strong> 0<br>
            <strong>Skipped:</strong> 0
        `;

        container.appendChild(buttonContainer);
        container.appendChild(progressContainer);
        document.body.appendChild(container);
    }

    function getButtonStyles(color) {
        return `
            flex: 1;
            padding: 6px 10px;
            background-color: ${color};
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: Arial, sans-serif;
            font-size: 13px;
        `;
    }

    function updateProgress() {
        const percentage = totalMedia > 0 ? Math.floor(((downloadedMedia + failedDownloads + skippedMedia) / totalMedia) * 100) : 0;
        progressContainer.innerHTML = `
            <strong>Progress:</strong> ${percentage}%<br>
            <strong>Downloaded:</strong> ${downloadedMedia}<br>
            <strong>Failed:</strong> ${failedDownloads}<br>
            <strong>Skipped:</strong> ${skippedMedia}
        `;
    }

    async function startMassDownload(tags, scoreThreshold) {
        totalMedia = 0;
        downloadedMedia = 0;
        failedDownloads = 0;
        skippedMedia = 0;

        let page = 0;
        let continueFetching = true;

        while (continueFetching && !stopRequested) {
            const url = generateSearchUrl(tags, page);
            console.log(`Fetching: ${url}`);

            const response = await fetchWithRetry(url);
            console.log(response);

            if (!response || response.length === 0 || stopRequested) {
                console.warn('No more posts found or stopped.');
                break;
            }

            const posts = parsePosts(response);

            const filteredPosts = posts.filter(post => (post.score || 0) >= scoreThreshold);

            totalMedia += filteredPosts.length;

            for (const post of filteredPosts) {
                if (stopRequested) break;

                if (post.file_url) {
                    if (!downloadedMediaSet.has(post.file_url) && !inProgressDownloads.has(post.file_url)) {
                        const fileName = `post_${post.id}`;
                        downloadMedia(post.file_url, fileName);
                    } else {
                        skippedMedia++;
                        newlySkippedSet.add(post.file_url);
                        updateProgress();
                    }
                } else {
                    console.warn(`Post ${post.id} has no file_url`);
                    failedDownloads++;
                    updateProgress();
                }
            }

            continueFetching = posts.length === MAX_PER_PAGE;
            page++;

            if (newlySkippedSet.size >= BATCH_SIZE) {
                saveSkippedMedia();
            }
        }

        if (stopRequested) {
            alert('Mass download stopped by user.');
        } else {
            checkCompletion();
        }
    }

    function saveSkippedMedia() {
        newlySkippedSet.forEach(url => downloadedMediaSet.add(url));
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([...downloadedMediaSet]));
        newlySkippedSet.clear();
        console.log('Saved skipped media to localStorage.');
    }

    function generateSearchUrl(tags, page) {
        if (window.location.hostname.includes('rule34.xxx')) {
            return `https://rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(tags)}&limit=${MAX_PER_PAGE}&pid=${page}`;
        } else if (window.location.hostname.includes('danbooru.donmai.us')) {
            return `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(tags)}&limit=${MAX_PER_PAGE}&page=${page + 1}`;
        } else if (window.location.hostname.includes('gelbooru.com')) {
            return `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(tags)}&limit=${MAX_PER_PAGE}&pid=${page}`;
        }
        throw new Error('Unsupported site');
    }

    function parsePosts(response) {
        if (Array.isArray(response)) {
            return response.map(post => ({
                id: post.id,
                file_url: post.file_url || post.large_file_url || post.preview_file_url,
                score: post.score || 0,
            }));
        } else if (response.post) {
            return Array.isArray(response.post) ? response.post : [response.post];
        }
        return [];
    }

    async function fetchWithRetry(url, retries = MAX_API_RETRIES) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function (response) {
                    if (response.status === 200) {
                        resolve(JSON.parse(response.responseText));
                    } else {
                        handleRetry(retries, reject, url);
                    }
                },
                onerror: function () {
                    handleRetry(retries, reject, url);
                }
            });
        });
    }

    function handleRetry(retries, reject, url) {
        if (retries > 0 && !stopRequested) {
            console.warn(`Retrying... (${retries} attempts left)`);
            fetchWithRetry(url, retries - 1).then(resolve).catch(reject);
        } else {
            console.error('Failed to fetch:', url);
            reject('Failed after retrying');
        }
    }

    function downloadMedia(url, baseFileName) {
        let fileExt = url.split('.').pop().split('?')[0];
        if (!fileExt.match(/^(jpg|jpeg|png|gif|webm|mp4|avi|mpg|mpeg)$/i)) {
            fileExt = 'jpg'; // Default to 'jpg' if the extension is not recognized
        }

        const fileName = `${baseFileName}.${fileExt}`;
        inProgressDownloads.add(url);

        GM_download({
            url: url,
            name: fileName,
            onload: () => {
                console.log(`Downloaded: ${fileName}`);
                downloadedMedia++;
                downloadedMediaSet.add(url);
                inProgressDownloads.delete(url);
                updateProgress();
            },
            onerror: (err) => {
                console.error(`Failed to download: ${url}`, err);
                failedDownloads++;
                inProgressDownloads.delete(url);
                updateProgress();
            },
        });
    }


    function checkCompletion() {
        saveSkippedMedia();
        const interval = setInterval(() => {
            if (downloadedMedia + failedDownloads + skippedMedia === totalMedia) {
                clearInterval(interval);
                progressContainer.innerHTML += '<br><strong>Download Complete!</strong>';
                alert(
                    `Mass download complete!\nSuccessful: ${downloadedMedia}\nFailed: ${failedDownloads}\nSkipped: ${skippedMedia}\nTotal: ${totalMedia}`
                );
            }
        }, 500);
    }

    window.addEventListener('load', () => {
        createUIContainer();
    });

    console.log('Multi-Site Media Downloader is active.');
})();
