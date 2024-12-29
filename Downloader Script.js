// ==UserScript==
// @name         Multi-Site Media Downloader
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Download images and videos from tags on Rule34, Gelbooru, and Danbooru
// @author       shadybrady
// @match        https://rule34.xxx/*
// @match        https://danbooru.donmai.us/*
// @match        https://gelbooru.com/*
// @downloadURL  https://raw.githubusercontent.com/shadybrady101/R34-Danbooru-media-downloader/refs/heads/main/Downloader%20Script.js
// @updateURL    https://raw.githubusercontent.com/shadybrady101/R34-Danbooru-media-downloader/refs/heads/main/Downloader%20Script.js
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// ==/UserScript==

(function () {
    'use strict';

    const MAX_PER_PAGE = 100;

    let totalMedia = 0;
    let downloadedMedia = 0;
    let failedDownloads = 0;
    let progressContainer;
    let stopRequested = false;

    const UI_WIDTH = '260px';

    // Create the main UI container
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

        // Add buttons and progress container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 6px; margin-bottom: 8px;';

        const downloadButton = document.createElement('button');
        downloadButton.innerText = 'Download';
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
            stopRequested = true;
            alert('Stopping download... Please wait for current processes to finish.');
        });

        buttonContainer.appendChild(downloadButton);
        buttonContainer.appendChild(stopButton);
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
            <strong>Failed:</strong> 0
        `;

        container.appendChild(progressContainer);
        document.body.appendChild(container);
    }

    // Generate button styles
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

    // Update the progress display
    function updateProgress() {
        const percentage = totalMedia > 0 ? Math.floor(((downloadedMedia + failedDownloads) / totalMedia) * 100) : 0;
        progressContainer.innerHTML = `
            <strong>Progress:</strong> ${percentage}%<br>
            <strong>Downloaded:</strong> ${downloadedMedia}<br>
            <strong>Failed:</strong> ${failedDownloads}
        `;
    }

    // Start mass download process
    async function startMassDownload(tags) {
        totalMedia = 0;
        downloadedMedia = 0;
        failedDownloads = 0;

        let page = 0;
        let continueFetching = true;

        while (continueFetching && !stopRequested) {
            const url = generateSearchUrl(tags, page);
            console.log(`Fetching: ${url}`);

            const response = await fetchWithRetry(url);
            if (!response || response.length === 0) {
                console.warn('No more posts found.');
                break;
            }

            const posts = parsePosts(response);
            totalMedia += posts.length;

            for (const post of posts) {
                if (stopRequested) break;

                if (post.file_url) {
                    const folderName = `downloads/${tags.replace(/ /g, '_')}`;
                    downloadMedia(post.file_url, folderName, `post_${post.id}`);
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

    // Generate search URL
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

    // Parse posts from API response
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

    // Fetch data with retry mechanism
    async function fetchWithRetry(url, retries = 3) {
        try {
            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    onload: (res) => resolve(JSON.parse(res.responseText)),
                    onerror: (err) => reject(err),
                });
            });
            return response;
        } catch (error) {
            if (retries > 0) {
                console.warn(`Retrying... (${retries} attempts left)`);
                return fetchWithRetry(url, retries - 1);
            } else {
                console.error('Failed to fetch:', error);
                return null;
            }
        }
    }

    // Download media
    function downloadMedia(url, folderName, baseFileName) {
        const fileExt = url.split('.').pop().split('?')[0];
        const fileName = `${folderName}/${baseFileName}.${fileExt}`;

        GM_download({
            url: url,
            name: fileName,
            onload: () => {
                console.log(`Downloaded: ${fileName}`);
                downloadedMedia++;
                updateProgress();
            },
            onerror: (err) => {
                console.error(`Failed to download: ${url}`, err);
                failedDownloads++;
                updateProgress();
            },
        });
    }

    // Check if all downloads are complete
    function checkCompletion() {
        const interval = setInterval(() => {
            if (downloadedMedia + failedDownloads === totalMedia) {
                clearInterval(interval);
                setTimeout(() => {
                    progressContainer.innerHTML += '<br><strong>Download Complete!</strong>';
                    alert(
                        `Mass download complete!\nSuccessful: ${downloadedMedia}\nFailed: ${failedDownloads}\nTotal: ${totalMedia}`
                    );
                }, 500);
            }
        }, 500);
    }

    // Initialize script
    window.addEventListener('load', () => {
        createUIContainer();
    });

    console.log('Multi-Site Media Downloader with Compact UI is active. Use the buttons to start or stop downloads.');
})();
