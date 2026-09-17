const fs = require('fs');
const path = require('path');

const MEDIA_DIRECTORIES = new Set(['images', 'videos']);

/**
 * Resolve a stored public media URL to a file directly inside an allowed
 * DATA_DIR media directory. Invalid, nested, or traversal paths are rejected.
 */
function resolveMediaAssetPath(dataDir, publicPath) {
  if (typeof dataDir !== 'string' || !dataDir || typeof publicPath !== 'string') {
    return null;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(publicPath);
  } catch {
    return null;
  }

  if (
    decodedPath.includes('\\') ||
    decodedPath.includes('\0') ||
    decodedPath.includes('?') ||
    decodedPath.includes('#')
  ) return null;

  const match = decodedPath.match(/^\/(images|videos)\/([^/]+)$/);
  if (!match) return null;

  const [, mediaDirectory, fileName] = match;
  if (!MEDIA_DIRECTORIES.has(mediaDirectory) || fileName === '.' || fileName === '..') {
    return null;
  }

  const mediaRoot = path.resolve(dataDir, mediaDirectory);
  const assetPath = path.resolve(mediaRoot, fileName);
  if (path.dirname(assetPath) !== mediaRoot) return null;

  return assetPath;
}

function deleteMediaAsset(dataDir, publicPath, fsImpl = fs) {
  const assetPath = resolveMediaAssetPath(dataDir, publicPath);
  if (!assetPath || !fsImpl.existsSync(assetPath)) return false;

  fsImpl.unlinkSync(assetPath);
  return true;
}

function deleteMediaAssetBestEffort(
  dataDir,
  publicPath,
  fsImpl = fs,
  warn = console.warn
) {
  try {
    return deleteMediaAsset(dataDir, publicPath, fsImpl);
  } catch (err) {
    warn('清理媒体文件失败:', publicPath, err.message);
    return false;
  }
}

module.exports = {
  resolveMediaAssetPath,
  deleteMediaAsset,
  deleteMediaAssetBestEffort
};
