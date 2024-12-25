// ==UserScript==
// @name         Multi-Site Media Downloader
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Download images and videos from tags on Rule34 and Danbooru with alert only after all downloads are complete
// @author       shadybrady
// @match        https://rule34.xxx/*
// @match        https://danbooru.donmai.us/*
// @match        https://www.danbooru.donmai.us/*
// @downloadURL  https://raw.githubusercontent.com/shadybrady101/R34-Danbooru-media-downloader/refs/heads/main/Downloader%20Script.js
// @updateURL    https://raw.githubusercontent.com/shadybrady101/R34-Danbooru-media-downloader/refs/heads/main/Downloader%20Script.js
// @grant        GM_download
// ==/UserScript==

(function () {
    'use strict';

    console.log("Script loaded on:", window.location.href);

    let progressContainer, progressBar, percentageDisplay;
    let totalMedia = 0;
    let downloadedMedia = 0;
    let failedDownloads = 0;

    // Function to detect the current site and configure API settings
    function getSiteConfig() {
        const hostname = window.location.hostname;

        if (hostname.includes("rule34.xxx")) {
            console.log("Detected Rule34");
            return {
                name: "Rule34",
                apiUrl: (tags, page) =>
                    `https://rule34.xxx/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
                        tags
                    )}&limit=100&pid=${page}`,
            };
        } else if (hostname.includes("danbooru.donmai.us")) {
            console.log("Detected Danbooru");
            return {
                name: "Danbooru",
                apiUrl: (tags, page) =>
                    `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(
                        tags
                    )}&limit=100&page=${page}`,
            };
        } else {
            alert("This site is not supported.");
            throw new Error("Unsupported site");
        }
    }

    // Function to fetch media based on tags
    async function fetchMediaFromTags(tags) {
        const siteConfig = getSiteConfig();
        let page = 0;
        let continueFetching = true;
        totalMedia = 0;
        downloadedMedia = 0;
        failedDownloads = 0;

        initializeProgressBar();

        while (continueFetching) {
            const url = siteConfig.apiUrl(tags, page);
            console.log(`Fetching: ${url}`);
            const response = await fetch(url);

            if (!response.ok) {
                alert(`Failed to fetch posts for tags: ${tags}`);
                return;
            }

            let posts = [];
            if (siteConfig.name === "Danbooru") {
                posts = await response.json();
            } else {
                const text = await response.text();
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(text, "text/xml");
                posts = Array.from(xmlDoc.getElementsByTagName("post"));
            }

            totalMedia += posts.length;

            if (posts.length > 0) {
                for (let i = 0; i < posts.length; i++) {
                    const post = posts[i];
                    let fileUrl;

                    if (siteConfig.name === "Danbooru") {
                        fileUrl = post.file_url;
                    } else {
                        fileUrl = post.getAttribute("file_url");
                    }

                    if (fileUrl) {
                        console.log(`Downloading: ${fileUrl}`);
                        downloadMedia(fileUrl, tags);
                    } else {
                        console.warn(`No valid file_url for post.`);
                        failedDownloads++;
                        checkCompletion();
                    }
                }

                continueFetching = posts.length === 100;
                page++;
            } else {
                continueFetching = false;
            }
        }
    }

    // Function to download media
    function downloadMedia(url, tags) {
        const sanitizedTags = tags.replace(/ /g, '_');
        const extension = url.split('.').pop();
        const filename = `${sanitizedTags}/${sanitizedTags}_${downloadedMedia + 1}.${extension}`;

        GM_download({
            url: url,
            name: filename,
            onload: () => {
                downloadedMedia++;
                updateProgressBar(downloadedMedia, totalMedia);
                checkCompletion();
                console.log(`Downloaded: ${downloadedMedia}/${totalMedia}`);
            },
            onerror: (err) => {
                console.error(`Failed to download ${url}:`, err);
                failedDownloads++;
                checkCompletion();
            },
        });
    }

    // Check if all downloads are completed
    function checkCompletion() {
        if (downloadedMedia + failedDownloads === totalMedia) {
            setTimeout(() => {
                alert(
                    `Download complete!\n` +
                    `Successful: ${downloadedMedia}\n` +
                    `Failed: ${failedDownloads}\n` +
                    `Total: ${totalMedia}`
                );
                hideProgressBar();
            }, 500);
        }
    }

    // Progress bar initialization
    function initializeProgressBar() {
        if (!progressContainer) {
            progressContainer = document.createElement('div');
            progressContainer.style.position = 'fixed';
            progressContainer.style.bottom = '10px';
            progressContainer.style.left = '10px';
            progressContainer.style.width = '300px';
            progressContainer.style.height = '20px';
            progressContainer.style.backgroundColor = '#ccc';
            progressContainer.style.borderRadius = '10px';
            progressContainer.style.overflow = 'hidden';
            progressContainer.style.zIndex = 1000;
            progressContainer.style.display = 'block';

            progressBar = document.createElement('div');
            progressBar.style.height = '100%';
            progressBar.style.width = '0%';
            progressBar.style.backgroundColor = '#4CAF50';
            progressBar.style.transition = 'width 0.3s ease';

            percentageDisplay = document.createElement('div');
            percentageDisplay.style.position = 'fixed';
            percentageDisplay.style.bottom = '35px';
            percentageDisplay.style.left = '10px';
            percentageDisplay.style.fontSize = '14px';
            percentageDisplay.style.color = '#000';
            percentageDisplay.style.fontWeight = 'bold';
            percentageDisplay.style.display = 'block';

            progressContainer.appendChild(progressBar);
            document.body.appendChild(progressContainer);
            document.body.appendChild(percentageDisplay);
        }

        progressBar.style.width = '0%';
        percentageDisplay.innerText = '0%';
    }

    // Update progress bar
    function updateProgressBar(downloaded, total) {
        const percentage = ((downloaded / total) * 100).toFixed(2);
        progressBar.style.width = `${percentage}%`;
        percentageDisplay.innerText = `Downloaded: ${percentage}% (${downloaded}/${total})`;
    }

    // Hide progress bar
    function hideProgressBar() {
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        if (percentageDisplay) {
            percentageDisplay.style.display = 'none';
        }
    }

    // Add the button when the DOM is fully ready
    document.addEventListener("DOMContentLoaded", () => {
        console.log("DOM fully loaded. Adding button...");
        addDownloadButton();
    });

    // Retry adding the button if it doesn't appear
    setTimeout(() => {
        if (!document.querySelector('#downloadMediaButton')) {
            console.log("Retrying button addition...");
            addDownloadButton();
        }
    }, 2000);

    // Function to add the "Download Media" button
    function addDownloadButton() {
        if (document.querySelector('#downloadMediaButton')) {
            console.log("Button already exists. Skipping re-addition.");
            return;
        }

        console.log("Adding Download Media button...");

        const button = document.createElement('button');
        button.id = 'downloadMediaButton';
        button.innerText = 'Download Media';
        button.style.position = 'fixed';
        button.style.top = '10px';
        button.style.right = '10px'; // Changed to position button in the top-right
        button.style.zIndex = 1000;
        button.style.backgroundColor = '#4CAF50';
        button.style.color = 'white';
        button.style.fontSize = '16px';
        button.style.padding = '10px 20px';
        button.style.borderRadius = '5px';
        button.style.cursor = 'pointer';

        button.onclick = () => {
            const tags = prompt("Enter the tags separated by spaces (e.g., 'tag1 tag2 tag3'):");
            if (tags) {
                fetchMediaFromTags(tags.trim());
            }
        };

        document.body.appendChild(button);
        console.log("Download Media button added.");
    }
})();
