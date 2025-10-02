document.addEventListener('DOMContentLoaded', () => {
    const searchForm = document.getElementById('nasaSearchForm');
    const searchInput = document.getElementById('nasaSearchInput');
    const resultsContainer = document.getElementById('nasaResults');

    // --- EVENT LISTENERS ---

    /**
     * Handles the search form submission.
     */
    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (!query) return;

        displayStatus('Searching for images...');

        try {
            const response = await fetch(`/api/nasa/search?q=${encodeURIComponent(query)}`);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Search failed: ${errorText}`);
            }
            const results = await response.json();
            displayResults(results);
        } catch (error) {
            displayError(error.message);
        }
    });

    /**
     * Handles clicks on a search result item using event delegation.
     * This now includes checking for high-res and asking the user.
     */
    resultsContainer.addEventListener('click', async (e) => {
        const clickedItem = e.target.closest('.nasa-item');
        if (!clickedItem) return;

        const nasaId = clickedItem.dataset.nasaId;
        const title = clickedItem.dataset.title;

        try {
            // Step 1: Check for available image resolutions
            displayStatus(`Checking resolutions for: <strong>${title}</strong>...`);
            const infoResponse = await fetch(`/api/nasa/asset-info/${nasaId}`);
            if (!infoResponse.ok) {
                throw new Error('Could not retrieve image information from server.');
            }
            const assetInfo = await infoResponse.json();

            let urlToProcess = null;

            // Step 2: Ask user for confirmation if a high-res version exists
            if (assetInfo.highResUrl) {
                const useHighRes = confirm(
                    'A high-resolution version is available. This file may be very large and take longer to process.\n\nDo you want to download the high-resolution version?'
                );
                
                if (useHighRes) {
                    urlToProcess = assetInfo.highResUrl;
                } else {
                    urlToProcess = assetInfo.ordinaryUrl;
                    // Handle edge case where only a high-res version exists
                    if (!urlToProcess) {
                        alert('Proceeding with the high-resolution version as it is the only one available.');
                        urlToProcess = assetInfo.highResUrl;
                    }
                }
            } else if (assetInfo.ordinaryUrl) {
                // No high-res available, so just use the ordinary one without asking
                urlToProcess = assetInfo.ordinaryUrl;
            } else {
                throw new Error('No downloadable image versions were found for this asset.');
            }
            
            // Step 3: Call the backend to process the chosen image URL
            displayStatus(`Processing: <strong>${title}</strong>. This may take a moment...`);
            const processResponse = await fetch('/api/process-nasa-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nasa_id: nasaId,
                    title: title,
                    imageUrl: urlToProcess // Send the chosen URL to the backend
                }),
            });

            if (!processResponse.ok) {
                const errorData = await processResponse.text();
                throw new Error(`Could not process image. Server said: ${errorData}`);
            }

            const processedImage = await processResponse.json();
            
            // Step 4: Redirect to the main viewer page
            window.location.href = `/?image_id=${processedImage.id}`;

        } catch (error) {
            displayError(error.message, true);
        }
    });

    // --- HELPER FUNCTIONS (No Changes) ---

    function displayResults(items) {
        resultsContainer.innerHTML = '';
        if (items.length === 0) {
            displayStatus('No results found for your query.');
            return;
        }
        items.forEach(item => {
            const resultItem = document.createElement('div');
            resultItem.className = 'nasa-item';
            resultItem.dataset.nasaId = item.nasa_id;
            resultItem.dataset.title = item.title;
            resultItem.innerHTML = `<img src="${item.thumbnail}" alt="${item.title}"><span class="nasa-item-title">${item.title}</span>`;
            resultsContainer.appendChild(resultItem);
        });
    }

    function displayStatus(message) {
        resultsContainer.innerHTML = `<p>${message}</p>`;
    }

    function displayError(message, showHelpText = false) {
        let helpText = showHelpText ? '<p>Please try another search or select a different image.</p>' : '';
        resultsContainer.innerHTML = `<p class="error">${message}</p>${helpText}`;
    }
});