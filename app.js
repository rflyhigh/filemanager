const express = require('express');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const fetch = require('node-fetch');
const ffmpeg = require('fluent-ffmpeg');

// Import models
const File = require('./models/File');
const Folder = require('./models/Folder');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Configure middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Set up view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1000 * 1024 * 1024 } // 1000MB limit
});

// Create temp directory for file uploads if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Parse bucket configuration from environment variable
let bucketConfig;
try {
  const configStr = process.env.BUCKET_CONFIG;
  bucketConfig = JSON.parse(configStr);
} catch (error) {
  console.error('Error parsing bucket config:', error);
  bucketConfig = {
    account1: { bucketName: 'Unconfigured', bucketId: '' },
    account2: { bucketName: 'Unconfigured', bucketId: '' }
  };
}

// Cache for B2 auth tokens
const authTokenCache = new Map();

// Helper function to get B2 authorization
async function getAuthToken(account) {
  // Check if we have a cached token
  if (authTokenCache.has(account)) {
    return authTokenCache.get(account);
  }
  
  let keyId, applicationKey;
  
  if (account === 'account1') {
    keyId = process.env.ACCOUNT1_KEY_ID;
    applicationKey = process.env.ACCOUNT1_APPLICATION_KEY;
  } else if (account === 'account2') {
    keyId = process.env.ACCOUNT2_KEY_ID;
    applicationKey = process.env.ACCOUNT2_APPLICATION_KEY;
  } else {
    throw new Error('Invalid account');
  }
  
  // Authorize with B2
  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(keyId + ':' + applicationKey).toString('base64')
    }
  });
  
  if (!authResponse.ok) {
    throw new Error('Failed to authenticate with B2');
  }
  
  const authData = await authResponse.json();
  
  // Cache the auth data
  authTokenCache.set(account, authData);
  
  return authData;
}

// Helper function to format file size
function formatSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to format time
function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return minutes + ':' + (secs < 10 ? '0' : '') + secs;
}

// Generate thumbnail for video file
async function generateVideoThumbnail(filePath, account, outputFileName) {
  return new Promise((resolve, reject) => {
    const thumbnailPath = path.join(tempDir, `${path.basename(filePath)}_thumb.jpg`);
    
    ffmpeg(filePath)
      .on('error', (err) => {
        console.error('Error generating thumbnail:', err);
        resolve(null); // Resolve with null instead of rejecting to continue the process
      })
      .on('end', async () => {
        try {
          // Upload thumbnail to B2
          const thumbnailData = fs.readFileSync(thumbnailPath);
          const uploadResult = await uploadFileToB2(
            account, 
            thumbnailData, 
            `thumbnails/${outputFileName}`, 
            'image/jpeg'
          );
          
          // Clean up temp file
          fs.unlinkSync(thumbnailPath);
          
          resolve(uploadResult);
        } catch (error) {
          console.error('Error uploading thumbnail:', error);
          resolve(null);
        }
      })
      .screenshots({
        count: 1,
        folder: path.dirname(thumbnailPath),
        filename: path.basename(thumbnailPath),
        size: '320x180',
        timestamps: ['10%']
      });
  });
}

// Get video duration
function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('Error getting video duration:', err);
        return resolve(null); // Resolve with null instead of rejecting
      }
      
      resolve(metadata.format.duration);
    });
  });
}

// Upload file to B2
async function uploadFileToB2(account, fileData, fileName, contentType) {
  try {
    // Get auth token for the selected account
    const authData = await getAuthToken(account);
    
    // Get upload URL
    const uploadUrlResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
      method: 'POST',
      headers: {
        'Authorization': authData.authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bucketId: bucketConfig[account].bucketId
      })
    });
    
    if (!uploadUrlResponse.ok) {
      throw new Error('Failed to get upload URL from B2');
    }
    
    const uploadUrlData = await uploadUrlResponse.json();
    
    // Calculate SHA1 hash of the file
    const sha1 = crypto.createHash('sha1').update(fileData).digest('hex');
    
    // Upload file to B2
    const uploadResponse = await fetch(uploadUrlData.uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': uploadUrlData.authorizationToken,
        'X-Bz-File-Name': encodeURIComponent(fileName),
        'Content-Type': contentType,
        'X-Bz-Content-Sha1': sha1,
        'X-Bz-Info-Author': 'file-manager-app'
      },
      body: fileData
    });
    
    if (!uploadResponse.ok) {
      throw new Error('Failed to upload file to B2');
    }
    
    return await uploadResponse.json();
  } catch (error) {
    console.error('Error uploading file to B2:', error);
    throw error;
  }
}

// Get download URL for a file
async function getDownloadUrl(account, fileName) {
  try {
    // Get auth token for the account
    const authData = await getAuthToken(account);
    
    // Get download authorization
    const downloadAuthResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_download_authorization`, {
      method: 'POST',
      headers: {
        'Authorization': authData.authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bucketId: bucketConfig[account].bucketId,
        fileNamePrefix: fileName,
        validDurationInSeconds: 86400 // 24 hours
      })
    });
    
    if (!downloadAuthResponse.ok) {
      throw new Error('Failed to get download authorization');
    }
    
    const downloadAuthData = await downloadAuthResponse.json();
    
    // Create a direct download URL with the authorization token
    return `${authData.downloadUrl}/file/${bucketConfig[account].bucketName}/${fileName}?Authorization=${downloadAuthData.authorizationToken}`;
  } catch (error) {
    console.error('Error getting download URL:', error);
    throw error;
  }
}

// Delete file from B2
async function deleteFileFromB2(account, fileId, fileName) {
  try {
    // Get auth token for the account
    const authData = await getAuthToken(account);
    
    // Delete file from B2
    const deleteResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_delete_file_version`, {
      method: 'POST',
      headers: {
        'Authorization': authData.authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileId: fileId,
        fileName: fileName
      })
    });
    
    if (!deleteResponse.ok) {
      throw new Error('Failed to delete file from B2');
    }
    
    return await deleteResponse.json();
  } catch (error) {
    console.error('Error deleting file from B2:', error);
    throw error;
  }
}

// Get breadcrumb path for a folder
async function getBreadcrumbPath(folderId) {
  const breadcrumb = [];
  
  if (!folderId) {
    return breadcrumb;
  }
  
  let currentFolder = await Folder.findById(folderId);
  if (!currentFolder) {
    return breadcrumb;
  }
  
  breadcrumb.unshift({
    id: currentFolder._id,
    name: currentFolder.name
  });
  
  while (currentFolder.parent) {
    currentFolder = await Folder.findById(currentFolder.parent);
    if (currentFolder) {
      breadcrumb.unshift({
        id: currentFolder._id,
        name: currentFolder.name
      });
    } else {
      break;
    }
  }
  
  return breadcrumb;
}

// Routes

// Home page
app.get('/', async (req, res) => {
  try {
    const accountList = Object.keys(bucketConfig);
    
    // Get recent files (limit to 20)
    const recentFiles = await File.find()
      .sort({ uploadTimestamp: -1 })
      .limit(20);
    
    // Get root folders
    const rootFolders = await Folder.find({ parent: null });
    
    res.render('index', {
      title: 'File Manager',
      files: recentFiles,
      folders: rootFolders,
      accounts: accountList,
      formatSize,
      formatTime,
      currentFolder: null
    });
  } catch (error) {
    console.error('Error handling home request:', error);
    res.status(500).send('Internal Server Error: ' + error.message);
  }
});

// Folder view
app.get('/folder/:id', async (req, res) => {
  try {
    const folderId = req.params.id;
    const accountList = Object.keys(bucketConfig);
    
    let folder = null;
    let query = {};
    let breadcrumb = [];
    
    // Check if the ID is an account name
    if (accountList.includes(folderId)) {
      // This is an account name, not a folder ID
      query.account = folderId;
      
      res.render('folder', {
        title: `${folderId} Files`,
        files: await File.find(query).sort({ uploadTimestamp: -1 }),
        folders: await Folder.find({ account: folderId, parent: null }).sort({ name: 1 }),
        accounts: accountList,
        currentFolder: null,
        folderId: 'root',
        breadcrumb: [],
        formatSize,
        formatTime
      });
      return;
    }
    
    // Regular folder handling
    if (folderId !== 'root') {
      // Get specific folder
      folder = await Folder.findById(folderId);
      
      if (!folder) {
        return res.status(404).send('Folder not found');
      }
      
      query.folder = folderId;
      breadcrumb = await getBreadcrumbPath(folderId);
    } else {
      // Root folder - get files with no folder
      query.folder = null;
    }
    
    // Get files in this folder
    const files = await File.find(query).sort({ uploadTimestamp: -1 });
    
    // Get subfolders
    const subfolders = await Folder.find(
      folderId === 'root' 
        ? { parent: null }
        : { parent: folderId }
    ).sort({ name: 1 });
    
    res.render('folder', {
      title: folder ? folder.name : 'All Files',
      files: files,
      folders: subfolders,
      accounts: accountList,
      currentFolder: folder,
      folderId: folderId,
      breadcrumb: breadcrumb,
      formatSize,
      formatTime
    });
  } catch (error) {
    console.error('Error handling folder request:', error);
    res.status(500).send('Internal Server Error: ' + error.message);
  }
});
// Simple health check endpoint
app.get('/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  
  res.json({
    status: 'ok',
    mongodb: mongoStatus,
    timestamp: new Date().toISOString()
  });
});
// File view
app.get('/file/:id', async (req, res) => {
  try {
    const fileId = req.params.id;
    const accountList = Object.keys(bucketConfig);
    
    // Get file
    const file = await File.findById(fileId);
    
    if (!file) {
      return res.status(404).send('File not found');
    }
    
    // Get breadcrumb path if file is in a folder
    let breadcrumb = [];
    if (file.folder) {
      breadcrumb = await getBreadcrumbPath(file.folder);
    }
    
    res.render('file', {
      title: file.title,
      file: file,
      accounts: accountList,
      breadcrumb: breadcrumb,
      formatSize,
      formatTime
    });
  } catch (error) {
    console.error('Error handling file request:', error);
    res.status(500).send('Internal Server Error: ' + error.message);
  }
});

// API Routes

// Get all folders
app.get('/api/folders', async (req, res) => {
  try {
    const { parent, account } = req.query;
    let query = {};
    
    if (parent) {
      query.parent = parent;
    } else if (parent === 'null') {
      query.parent = null;
    }
    
    if (account && account !== 'all') {
      query.account = account;
    }
    
    const folders = await Folder.find(query).sort({ name: 1 });
    
    res.json(folders);
  } catch (error) {
    console.error('Error getting folders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create folder
app.post('/api/folders', async (req, res) => {
  try {
    const { name, parent, account } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // Use default account if not provided
    const folderAccount = account || 'account1';
    
    // Determine the path
    let path = name;
    
    if (parent) {
      const parentFolder = await Folder.findById(parent);
      
      if (!parentFolder) {
        return res.status(404).json({ error: 'Parent folder not found' });
      }
      
      path = `${parentFolder.path}/${name}`;
    }
    
    // Create the folder
    const folder = new Folder({
      name,
      parent: parent || null,
      path,
      account: folderAccount
    });
    
    await folder.save();
    
    res.status(201).json(folder);
  } catch (error) {
    console.error('Error creating folder:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete folder
app.delete('/api/folders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if folder exists
    const folder = await Folder.findById(id);
    
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    // Check if folder has files
    const filesCount = await File.countDocuments({ folder: id });
    
    if (filesCount > 0) {
      return res.status(400).json({ error: 'Cannot delete folder with files' });
    }
    
    // Check if folder has subfolders
    const subfoldersCount = await Folder.countDocuments({ parent: id });
    
    if (subfoldersCount > 0) {
      return res.status(400).json({ error: 'Cannot delete folder with subfolders' });
    }
    
    // Delete the folder
    await folder.deleteOne();
    
    res.json({ success: true, message: 'Folder deleted successfully' });
  } catch (error) {
    console.error('Error deleting folder:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rename folder
app.put('/api/folders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // Check if folder exists
    const folder = await Folder.findById(id);
    
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    // Update folder name and path
    const oldPath = folder.path;
    const newPath = folder.parent 
      ? `${(await Folder.findById(folder.parent)).path}/${name}`
      : name;
    
    folder.name = name;
    folder.path = newPath;
    
    await folder.save();
    
    // Update paths of all subfolders
    await updateSubfolderPaths(oldPath, newPath);
    
    res.json({ success: true, message: 'Folder renamed successfully', folder });
  } catch (error) {
    console.error('Error renaming folder:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to update paths of subfolders
async function updateSubfolderPaths(oldPath, newPath) {
  const subfolders = await Folder.find({ path: { $regex: `^${oldPath}/` } });
  
  for (const subfolder of subfolders) {
    subfolder.path = subfolder.path.replace(oldPath, newPath);
    await subfolder.save();
  }
}

// Move files to folder
app.post('/api/files/move', async (req, res) => {
  try {
    const { fileIds, folderId } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds)) {
      return res.status(400).json({ error: 'File IDs are required' });
    }
    
    // Check if folder exists if folderId is not null
    if (folderId && folderId !== 'null') {
      const folder = await Folder.findById(folderId);
      
      if (!folder) {
        return res.status(404).json({ error: 'Folder not found' });
      }
    }
    
    // Update files
    const updateResult = await File.updateMany(
      { _id: { $in: fileIds } },
      { folder: folderId === 'null' ? null : folderId }
    );
    
    res.json({ 
      success: true, 
      message: 'Files moved successfully',
      count: updateResult.modifiedCount
    });
  } catch (error) {
    console.error('Error moving files:', error);
    res.status(500).json({ error: error.message });
  }
});

// Handle file uploads
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { account, title, folderId } = req.body;
    const file = req.file;
    
    // Validate inputs
    if (!account || !file) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if the account exists in our configuration
    if (!bucketConfig[account]) {
      return res.status(400).json({ error: 'Invalid account selected' });
    }
    
    // Use file name without extension as title if not provided
    const fileTitle = title || path.basename(file.originalname, path.extname(file.originalname));
    
    // Generate a safe filename (preserve original case)
    const timestamp = Date.now();
    const filename = `${fileTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}`;
    const extension = path.extname(file.originalname);
    const fullFilename = `${filename}${extension}`;
    const b2FileName = `files/${fullFilename}`;
    
    // Get file data
    const fileData = fs.readFileSync(file.path);
    
    // Upload file to B2
    const uploadResult = await uploadFileToB2(
      account, 
      fileData, 
      b2FileName, 
      file.mimetype || 'application/octet-stream'
    );
    
    // Generate URL for the uploaded file
    const fileUrl = `/files/${account}/${fullFilename}`;
    
    // Create file record in database
    const fileRecord = new File({
      title: fileTitle,
      fileName: fullFilename,
      fullFileName: b2FileName,
      fileId: uploadResult.fileId,
      size: file.size,
      contentType: file.mimetype,
      account,
      url: fileUrl,
      folder: folderId === 'null' ? null : folderId,
      uploadTimestamp: timestamp
    });
    
    // If it's a video file, generate thumbnail and get duration
    if (file.mimetype.startsWith('video/')) {
      try {
        // Get video duration
        const duration = await getVideoDuration(file.path);
        if (duration) {
          fileRecord.duration = duration;
        }
        
        // Generate and upload thumbnail
        const thumbnailFileName = `${filename}.jpg`;
        const thumbnailResult = await generateVideoThumbnail(
          file.path,
          account,
          thumbnailFileName
        );
        
        if (thumbnailResult) {
          fileRecord.thumbnailUrl = `/thumbnails/${account}/${thumbnailFileName}`;
        }
      } catch (err) {
        console.error('Error processing video:', err);
        // Continue without thumbnail if there's an error
      }
    }
    
    await fileRecord.save();
    
    // Clean up temp file
    fs.unlinkSync(file.path);
    
    // Return success response
    return res.status(201).json({
      success: true,
      file: fileRecord
    });
  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up temp file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    return res.status(500).json({ error: error.message });
  }
});

// Delete file
app.post('/api/files/delete', async (req, res) => {
  try {
    const { fileId } = req.body;
    
    // Validate inputs
    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }
    
    // Find file in database
    const file = await File.findById(fileId);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Delete from B2
    try {
      await deleteFileFromB2(file.account, file.fileId, file.fullFileName);
      
      // Delete thumbnail if it exists
      if (file.thumbnailUrl) {
        const thumbnailFileName = `thumbnails/${path.basename(file.thumbnailUrl.split('/').pop())}`;
        try {
          await deleteFileFromB2(file.account, null, thumbnailFileName);
        } catch (error) {
          console.error('Error deleting thumbnail:', error);
          // Continue even if thumbnail deletion fails
        }
      }
    } catch (error) {
      console.error('Error deleting file from B2:', error);
      // Continue with database deletion even if B2 deletion fails
    }
    
    // Delete from database
    await file.deleteOne();
    
    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rename file
app.post('/api/files/rename', async (req, res) => {
  try {
    const { fileId, newTitle } = req.body;
    
    // Validate inputs
    if (!fileId || !newTitle) {
      return res.status(400).json({ error: 'File ID and new title are required' });
    }
    
    // Find file in database
    const file = await File.findById(fileId);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Update file title
    file.title = newTitle;
    await file.save();
    
    res.json({ 
      success: true, 
      message: 'File renamed successfully',
      file
    });
  } catch (error) {
    console.error('Rename error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Handle file serving
app.get('/files/:account/:filename', async (req, res) => {
  try {
    // Parse the URL to get account and filename
    const account = req.params.account;
    const filename = req.params.filename;
    
    // Check if the account exists
    if (!bucketConfig[account]) {
      return res.status(400).send('Invalid account');
    }
    
    // Get download URL
    const downloadUrl = await getDownloadUrl(account, `files/${filename}`);
    
    // Redirect to the direct download URL
    return res.redirect(downloadUrl);
  } catch (error) {
    console.error('File serving error:', error);
    return res.status(500).send(`Error serving file: ${error.message}`);
  }
});

// Handle thumbnail serving
app.get('/thumbnails/:account/:filename', async (req, res) => {
  try {
    // Parse the URL to get account and filename
    const account = req.params.account;
    const filename = req.params.filename;
    
    // Check if the account exists
    if (!bucketConfig[account]) {
      return res.status(400).send('Invalid account');
    }
    
    // Get download URL
    const downloadUrl = await getDownloadUrl(account, `thumbnails/${filename}`);
    
    // Redirect to the direct download URL
    return res.redirect(downloadUrl);
  } catch (error) {
    console.error('Thumbnail serving error:', error);
    return res.status(500).send(`Error serving thumbnail: ${error.message}`);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});