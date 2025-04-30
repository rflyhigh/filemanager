const mongoose = require('mongoose');

const FileSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  fileName: {
    type: String,
    required: true
  },
  fullFileName: {
    type: String,
    required: true
  },
  fileId: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  contentType: {
    type: String,
    required: true
  },
  account: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  thumbnailUrl: {
    type: String,
    default: null
  },
  folder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    default: null
  },
  duration: {
    type: Number,
    default: null
  },
  uploadTimestamp: {
    type: Number,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('File', FileSchema);