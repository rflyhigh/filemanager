const mongoose = require('mongoose');

const FolderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    default: null
  },
  path: {
    type: String,
    required: true
  },
  account: {
    type: String,
    default: 'account1' // Default account, no longer required
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Folder', FolderSchema);