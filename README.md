# Large Image Viewer with Deep Zoom

A professional web application for viewing and annotating high-resolution images using OpenSeadragon deep zoom technology. Features NASA image search integration and direct URL processing.

## 🌟 Features

- **Deep Zoom Viewing**: Smoothly navigate massive images with OpenSeadragon
- **NASA Image Search**: Search and download high-resolution images from NASA's archive
- **Direct URL Processing**: Process any image URL into zoomable tiles
- **Annotations**: Add and manage location-based annotations on images
- **Image Library**: Manage your processed images with easy deletion
- **Responsive Design**: Works on desktop, tablet, and mobile devices

## 📋 Prerequisites

Before running this application, ensure you have:

1. **Node.js** (v14 or higher)
2. **VIPS** - Image processing library
   - **macOS**: `brew install vips`
   - **Ubuntu/Debian**: `sudo apt-get install libvips-tools`
   - **Windows**: Download from [libvips.github.io](https://libvips.github.io/libvips/install.html)
3. **npm** or **yarn** package manager

## 🚀 Installation

1. **Clone or download the project**

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Verify VIPS installation**:
   ```bash
   vips --version
   ```
   You should see version information if installed correctly.

## 📁 Project Structure

```
project/
├── server/
│   ├── server.js           # Express server with API endpoints
│   └── data/               # JSON databases (auto-created)
│       ├── images.json
│       └── annotations.json
└── public/
    ├── index.html          # Main viewer page
    ├── search.html         # Search interface
    ├── style.css           # All styles
    ├── gigaimages/         # Processed image tiles (auto-created)
    └── js/
        ├── script.js       # Main viewer logic
        ├── search.js       # Search page logic
        └── openseadragon.min.js  # Deep zoom library
```

## 🎯 Usage

### Starting the Server

```bash
cd server
node server.js
```

The server will start on `http://localhost:3000`

### Using the Viewer

1. **Open** `http://localhost:3000` in your browser
2. **Search** for NASA images or process a direct URL via the search page
3. **View** images with smooth pan and zoom
4. **Annotate** images by clicking "Add Pin" and clicking on the image
5. **Navigate** to annotations by clicking them in the sidebar
6. **Delete** images using the trash button

## 🔧 API Endpoints

### Image Management
- `GET /api/images` - List all processed images
- `DELETE /api/images/:id` - Delete an image and its data

### NASA Integration
- `GET /api/nasa/search?q=query` - Search NASA image archive
- `GET /api/nasa/asset-info/:nasa_id` - Get asset resolution info
- `POST /api/process-nasa-image` - Process a NASA image

### Direct URL Processing
- `POST /api/process-url` - Process an image from any URL

### Annotations
- `GET /api/images/:id/annotations` - Get annotations for an image
- `POST /api/images/:id/annotations` - Save a new annotation

### Health Check
- `GET /api/health` - Check server and VIPS status

## 🛡️ Security Features

- Input validation on all endpoints
- URL validation and sanitization
- File size limits (1GB max)
- Request timeouts for large operations
- Secure filename handling
- Protected against path traversal attacks

## ⚙️ Configuration

You can customize these settings in `server.js`:

```javascript
const PORT = process.env.PORT || 3000;
const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 255;
const MAX_ANNOTATION_LENGTH = 500;
const REQUEST_TIMEOUT = 300000; // 5 minutes
```

## 🐛 Troubleshooting

### "VIPS is not installed"
- Ensure VIPS is installed and in your system PATH
- Try running `vips --version` in terminal
- Restart terminal/server after installation

### Image Processing Fails
- Check if the image URL is accessible
- Verify the image format is supported (.jpg, .tif, .png, etc.)
- Check server logs for detailed error messages
- Ensure sufficient disk space for processing

### Annotations Not Saving
- Check browser console for errors
- Verify the image exists in the database
- Check `data/annotations.json` file permissions

### Port Already in Use
- Change the PORT in `server.js` or use environment variable:
  ```bash
  PORT=3001 node server.js
  ```

## 🔍 Browser Compatibility

- Chrome/Edge: ✅ Fully supported
- Firefox: ✅ Fully supported
- Safari: ✅ Fully supported
- Opera: ✅ Fully supported
- IE11: ❌ Not supported

## 📦 Dependencies

### Backend
- **express** - Web server framework
- **axios** - HTTP client for API requests
- **cors** - Cross-origin resource sharing

### Frontend
- **OpenSeadragon** - Deep zoom image viewer
- No additional build tools required!

## 🎨 Customization

### Changing Colors
Edit CSS variables in `style.css`:

```css
:root {
  --sidebar-width: 320px;
  --bg-color: #1a1a1d;
  --panel-color: #2c2c34;
  --text-color: #e1e1e1;
  --primary-color: #007bff;
  --danger-color: #dc3545;
  --success-color: #28a745;
}
```

### Adding Image Sources
Extend the search functionality in `search.js` and add corresponding API endpoints in `server.js`.

## 📝 Error Handling

All operations include comprehensive error handling:
- Network failures are caught and reported
- File system errors are logged and cleaned up
- Invalid inputs are validated before processing
- User-friendly error messages are displayed

## 🚀 Performance Tips

1. **Large Images**: High-resolution images may take several minutes to process
2. **Disk Space**: Processed images create tile pyramids (~2-3x original size)
3. **Memory**: VIPS is memory-efficient but large batches may require monitoring
4. **Caching**: Images are cached; re-processing the same URL is instant

## 📄 License

This project is provided as-is for educational and personal use.

## 🤝 Contributing

Contributions are welcome! Please ensure:
- Code follows existing style
- Error handling is comprehensive
- Changes are tested across browsers
- Documentation is updated

## 💡 Future Enhancements

- [ ] User authentication
- [ ] Annotation editing and deletion
- [ ] Image comparison mode
- [ ] Batch image processing
- [ ] Export annotations as JSON/CSV
- [ ] Collaborative viewing sessions
- [ ] Image measurement tools

## 📞 Support

For issues or questions:
1. Check the Troubleshooting section
2. Review server logs for detailed errors
3. Verify all prerequisites are installed correctly
4. Check browser console for client-side errors

---

**Built with** ❤️ **using Node.js, Express, and OpenSeadragon**