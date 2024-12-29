// ==UserScript==
// @name         Multi-Site Media Downloader
// @namespace    http://tampermonkey.net/
// @version      2.1
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

    const MAX_PER_PAGE = 100;

    let totalMedia = 0;
    let downloadedMedia = 0;
    let failedDownloads = 0;
    let skippedMedia = 0;
    let progressContainer;
    let stopRequested = false;
    const abortControllers = []; // Tracks abort controllers for ongoing fetches

    const UI_WIDTH = '260px';
    const downloadedMediaSet = new Set(
        JSON.parse(localStorage.getItem('downloadedMedia') || '[]')
    );
    const inProgressDownloads = new Set(); // Tracks currently downloading files

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
            width: ${UI_WIDTH};
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
            font-family: Arial, sans-serif;
            font-size: 13px;
        `;
        container.id = 'multiSiteDownloaderUI';

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap;';

        const downloadButton = document.createElement('button');
        downloadButton.innerText = 'Download/Resume';
        downloadButton.style.cssText = getButtonStyles('#4CAF50');
        downloadButton.addEventListener('click', () => {
            const tags = prompt('Enter tags for mass download (separated by spaces):');
            if (tags) {
                stopRequested = false;
                startMassDownload(tags.trim());
            }
        });

        const stopButton = document.createElement('button');
        stopButton.innerText = 'Stop';
        stopButton.style.cssText = getButtonStyles('#F44336');
        stopButton.addEventListener('click', () => {
            if (confirm('Stop all processes?')) {
                stopRequested = true;
                abortControllers.forEach(controller => controller.abort()); // Abort all ongoing fetches
                alert('Stopping downloads. This may take a moment.');
            }
        });

        const resetButton = document.createElement('button');
        resetButton.innerText = 'Reset Skipped';
        resetButton.style.cssText = getButtonStyles('#FFC107');
        resetButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to reset skipped tracking?')) {
                downloadedMediaSet.clear();
                localStorage.setItem('downloadedMedia', JSON.stringify([...downloadedMediaSet]));
                alert('Skipped tracking has been reset.');
            }
        });

        buttonContainer.appendChild(downloadButton);
        buttonContainer.appendChild(stopButton);
        buttonContainer.appendChild(resetButton);
        container.appendChild(buttonContainer);

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

    async function startMassDownload(tags) {
        totalMedia = 0;
        downloadedMedia = 0;
        failedDownloads = 0;
        skippedMedia = 0;

        let page = 0;
        let continueFetching = true;

        while (continueFetching && !stopRequested) {
            const controller = new AbortController(); // Create an abort controller
            abortControllers.push(controller);

            const url = generateSearchUrl(tags, page);
            console.log(`Fetching: ${url}`);

            const response = await fetchWithRetry(url, controller.signal);
            if (!response || response.length === 0 || stopRequested) {
                console.warn('No more posts found or stopped.');
                break;
            }

            const posts = parsePosts(response);
            totalMedia += posts.length;

            for (const post of posts) {
                if (stopRequested) break;

                if (post.file_url) {
                    if (!downloadedMediaSet.has(post.file_url) && !inProgressDownloads.has(post.file_url)) {
                        const folderName = `downloads/${tags.replace(/ /g, '_')}`;
                        downloadMedia(post.file_url, folderName, `post_${post.id}`);
                    } else {
                        skippedMedia++;
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
        }

        if (stopRequested) {
            alert('Mass download stopped by user.');
        } else {
            checkCompletion();
        }
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
                file_url: post.file_url || post.large_file_url || post.preview_file_url
            }));
        } else if (response.post) {
            return Array.isArray(response.post) ? response.post : [response.post];
        }
        return [];
    }

    async function fetchWithRetry(url, signal, retries = 3) {
        try {
            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    onload: (res) => resolve(JSON.parse(res.responseText)),
                    onerror: (err) => reject(err),
                    signal, // Attach abort signal
                });
            });
            return response;
        } catch (error) {
            if (retries > 0 && !stopRequested) {
                console.warn(`Retrying... (${retries} attempts left)`);
                return fetchWithRetry(url, signal, retries - 1);
            } else {
                console.error('Failed to fetch:', error);
                return null;
            }
        }
    }

    function downloadMedia(url, folderName, baseFileName) {
        let fileExt = url.split('.').pop().split('?')[0];
        if (!fileExt.match(/^(jpg|jpeg|png|gif|webm|mp4)$/i)) {
            fileExt = 'jpg'; // Default to .jpg for unknown extensions
        }

        const fileName = `${folderName}/${baseFileName}.${fileExt}`;
        inProgressDownloads.add(url);

        GM_download({
            url: url,
            name: fileName,
            onload: () => {
                console.log(`Downloaded: ${fileName}`);
                downloadedMedia++;
                downloadedMediaSet.add(url);
                inProgressDownloads.delete(url);
                localStorage.setItem('downloadedMedia', JSON.stringify([...downloadedMediaSet]));
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
        const interval = setInterval(() => {
            if (downloadedMedia + failedDownloads + skippedMedia === totalMedia) {
                clearInterval(interval);
                setTimeout(() => {
                    progressContainer.innerHTML += '<br><strong>Download Complete!</strong>';
                    alert(
                        `Mass download complete!\nSuccessful: ${downloadedMedia}\nFailed: ${failedDownloads}\nSkipped: ${skippedMedia}\nTotal: ${totalMedia}`
                    );
                }, 500);
            }
        }, 500);
    }

    window.addEventListener('load', () => {
        createUIContainer();
    });

    console.log('Multi-Site Media Downloader with Enhanced Stop Functionality is active.');
})();
