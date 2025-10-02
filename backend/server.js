// Import required packages
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises; // Use the promise-based version of fs
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const crypto = require('crypto');

// Create an Express application
const app = express();
const PORT = 3000;
const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';

// --- File Paths ---
const dataPath = path.join(__dirname, 'data');
const imagesDbPath = path.join(__dirname, 'data', 'images.json');
const annotationsDbPath = path.join(__dirname, 'data', 'annotations.json');
const gigaImagesPath = path.join(__dirname, '../public/gigaimages');

// --- Directory and File Initialization on Server Start ---
(async () => {
    try {
        console.log('Initializing required directories and files...');
        await fs.mkdir(dataPath, { recursive: true });
        await fs.mkdir(gigaImagesPath, { recursive: true });
        console.log('Directories are ready.');
        try {
            await fs.access(imagesDbPath);
        } catch (error) {
            console.log('images.json not found, creating it...');
            await fs.writeFile(imagesDbPath, JSON.stringify([], null, 2), 'utf8');
        }
        try {
            await fs.access(annotationsDbPath);
        } catch (error) {
            console.log('annotations.json not found, creating it...');
            await fs.writeFile(annotationsDbPath, JSON.stringify({}, null, 2), 'utf8');
        }
        console.log('Initialization check complete.');
    } catch (error) {
        console.error('FATAL: Failed to initialize required directories or files:', error);
        process.exit(1);
    }
})();

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// --- Routes ---

app.get('/search', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/search.html'));
});

app.get('/api/images', async (req, res) => {
  console.log('Request received to list all processed images.');
  try {
    const dbData = await fs.readFile(imagesDbPath, 'utf8');
    const imageDb = JSON.parse(dbData);
    const directories = await fs.readdir(gigaImagesPath, { withFileTypes: true });
    const imageFolders = directories.filter(d => d.isDirectory()).map(d => d.name);
    const allImages = imageFolders.map(folderId => {
      const dbEntry = imageDb.find(img => img.id === folderId);
      return {
        id: folderId,
        name: dbEntry ? dbEntry.name : folderId,
        path: `gigaimages/${folderId}/tiles.dzi`
      };
    });
    console.log(`Found and listed ${allImages.length} images.`);
    res.json(allImages);
  } catch (error) {
    console.error('Error listing images:', error);
    res.status(500).send('Error listing images.');
  }
});

// FIXED: Endpoint to check for available image resolutions
app.get('/api/nasa/asset-info/:nasa_id', async (req, res) => {
    const { nasa_id } = req.params;
    console.log(`[INFO] Fetching asset info for NASA ID: ${nasa_id}`);
    try {
        const assetUrl = `https://images-api.nasa.gov/asset/${nasa_id}`;
        const response = await axios.get(assetUrl);
        const items = response.data.collection.items;

        const highResItem = items.find(item => item.href.includes('~orig.tif') || item.href.includes('~orig.jpg'));
        const largeItem = items.find(item => item.href.includes('~large.jpg'));
        const mediumItem = items.find(item => item.href.includes('~medium.jpg'));
        
        // Robust Fallback: Find the first available JPG as a general-purpose fallback.
        const firstJpgItem = items.find(item => item.href.toLowerCase().endsWith('.jpg'));

        // Determine the best "ordinary" image, prioritizing standard sizes.
        const ordinaryUrl = largeItem?.href || mediumItem?.href || firstJpgItem?.href;

        if (!highResItem && !ordinaryUrl) {
            return res.status(404).send('No downloadable image assets found (JPG, TIF).');
        }

        res.json({
            highResUrl: highResItem?.href || null,
            ordinaryUrl: ordinaryUrl || null // Ensure it can be null if no jpg/large/medium is found
        });

    } catch (error) {
        // Improved error logging
        console.error(`[INFO] Error fetching asset info for ${nasa_id}:`, error.response ? error.response.data : error.message);
        res.status(500).send('Failed to fetch asset information from NASA.');
    }
});


// FIXED: Process a NASA Image and UPDATE the database
app.post('/api/process-nasa-image', async (req, res) => {
    const { nasa_id, title, imageUrl } = req.body;
    console.log(`\n--- New Image Request ---`);
    console.log(`[INIT] Processing request for NASA ID: ${nasa_id} (Title: ${title})`);
    if (!nasa_id) { return res.status(400).send('NASA ID is required.'); }

    const imageId = crypto.createHash('md5').update(nasa_id).digest('hex');
    const imageFolderPath = path.join(gigaImagesPath, imageId);
    const dziPath = path.join(imageFolderPath, 'tiles.dzi');
    const relativeDziPath = `gigaimages/${imageId}/tiles.dzi`;

    try {
        await fs.access(dziPath);
        console.log(`[CACHE HIT] Image ${imageId} already processed. Serving from cache.`);
        return res.json({ id: imageId, path: relativeDziPath });
    } catch (e) {
        console.log(`[CACHE MISS] Image ${imageId} not found. Starting new processing workflow.`);
    }

    try {
        let finalImageUrl = imageUrl;
        // Fallback logic if no URL is provided directly by the client (uses the same robust logic)
        if (!finalImageUrl) {
            console.log(`[API] No image URL provided by client, finding best available...`);
            const assetUrl = `https://images-api.nasa.gov/asset/${nasa_id}`;
            const assetResponse = await axios.get(assetUrl);
            const items = assetResponse.data.collection.items;
            const originalImageUrlItem = items.find(item => item.href.includes('~orig.tif') || item.href.includes('~orig.jpg'));
            const largeImageUrlItem = items.find(item => item.href.includes('~large.jpg'));
            const firstJpgItem = items.find(item => item.href.toLowerCase().endsWith('.jpg'));
            finalImageUrl = originalImageUrlItem?.href || largeImageUrlItem?.href || firstJpgItem?.href;
        }

        if (!finalImageUrl) { throw new Error('Could not find a downloadable image URL.'); }
        console.log(`[API] Selected image URL for download: ${finalImageUrl}`);

        const tempImageName = `${imageId}_temp${path.extname(new URL(finalImageUrl).pathname)}`;
        const tempImagePath = path.join(__dirname, 'data', tempImageName);
        
        await fs.mkdir(path.dirname(tempImagePath), { recursive: true });
        const writer = require('fs').createWriteStream(tempImagePath);
        console.log(`[DOWNLOAD] Starting download to ${tempImagePath}...`);

        const downloadResponse = await axios({ url: finalImageUrl, method: 'GET', responseType: 'stream' });
        downloadResponse.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', () => { console.log('[DOWNLOAD] Download complete.'); resolve(); });
            writer.on('error', reject);
        });
        
        await fs.mkdir(imageFolderPath, { recursive: true });
        const vipsCommand = `vips dzsave "${tempImagePath}" "${path.join(imageFolderPath, 'tiles')}"`;
        console.log(`[VIPS] Executing command: ${vipsCommand}`);
        
        exec(vipsCommand, async (error, stdout, stderr) => {
            console.log(`[VIPS] Deleting temporary file: ${tempImagePath}`);
            await fs.unlink(tempImagePath).catch(err => console.error("Failed to delete temp file:", err));
            if (error) {
                console.error(`[VIPS] Error: ${stderr}`);
                return res.status(500).send('Failed to process image with VIPS.');
            }
            console.log(`[VIPS] Image processing complete for ${imageId}.`);
            console.log(`[DB] Updating images.json and annotations.json...`);
            const [imagesDbData, annotationsDbData] = await Promise.all([
                fs.readFile(imagesDbPath, 'utf8'),
                fs.readFile(annotationsDbPath, 'utf8')
            ]);
            const imagesDb = JSON.parse(imagesDbData);
            const annotationsDb = JSON.parse(annotationsDbData);
            if (!imagesDb.find(img => img.id === imageId)) {
                imagesDb.push({ id: imageId, name: title, path: relativeDziPath, source: 'nasa' });
                if (!annotationsDb[imageId]) {
                    annotationsDb[imageId] = [];
                }
            }
            await Promise.all([
                fs.writeFile(imagesDbPath, JSON.stringify(imagesDb, null, 2)),
                fs.writeFile(annotationsDbPath, JSON.stringify(annotationsDb, null, 2))
            ]);
            console.log(`[DB] Databases updated successfully.`);
            console.log(`[SUCCESS] Finished processing request for ${nasa_id}.`);
            res.status(201).json({ id: imageId, path: relativeDziPath });
        });
    } catch (error) {
        console.error('Error during NASA image processing workflow:', error.message);
        res.status(500).send('Error processing NASA image.');
    }
});

// Search NASA API
app.get('/api/nasa/search', async (req, res) => {
    const query = req.query.q;
    console.log(`Received NASA search request with query: "${query}"`);
    if (!query) { return res.status(400).send('Search query is required.'); }
    try {
        const nasaApiUrl = `https://images-api.nasa.gov/search`;
        const response = await axios.get(nasaApiUrl, {
            params: { q: query, media_type: 'image' }
        });
        const results = response.data.collection.items.map(item => ({
            nasa_id: item.data[0].nasa_id,
            title: item.data[0].title,
            thumbnail: item.links ? item.links[0].href : null,
        })).filter(item => item.thumbnail);
        console.log(`Found ${results.length} results for query "${query}".`);
        res.json(results.slice(0, 50));
    } catch (error) {
        console.error('NASA API Search Error:', error.response ? error.response.data : error.message);
        res.status(500).send('Error searching NASA images.');
    }
});

// Annotation APIs (no changes)
app.get('/api/images/:id/annotations', async (req, res) => {
    const imageId = req.params.id;
    console.log(`Fetching annotations for image ID: ${imageId}`);
    try {
        const data = await fs.readFile(annotationsDbPath, 'utf8');
        const allAnnotations = JSON.parse(data);
        const imageAnnotations = allAnnotations[imageId] || [];
        res.json(imageAnnotations);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`No annotations file found for ${imageId}, returning empty array.`);
            return res.json([]);
        }
        console.error('Error reading annotations:', error);
        res.status(500).send('Error reading annotations.');
    }
});
app.post('/api/images/:id/annotations', async (req, res) => {
    const imageId = req.params.id;
    console.log(`Saving new annotation for image ID: ${imageId}`);
    try {
        let allAnnotations = {};
        try {
            const data = await fs.readFile(annotationsDbPath, 'utf8');
            allAnnotations = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            console.log('Annotations file not found, creating a new one.');
        }
        if (!allAnnotations[imageId]) {
            allAnnotations[imageId] = [];
        }
        allAnnotations[imageId].push(req.body);
        await fs.writeFile(annotationsDbPath, JSON.stringify(allAnnotations, null, 2));
        console.log(`Successfully saved annotation for ${imageId}.`);
        res.status(201).json(req.body);
    } catch (error) {
        console.error('Error saving annotation:', error);
        res.status(500).send('Error saving annotation.');
    }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});