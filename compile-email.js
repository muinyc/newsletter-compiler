#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const inlineCSS = require('inline-css');
const { minify } = require('html-minifier-terser');
const yaml = require('js-yaml');
const crypto = require('crypto');
const slugify = require('slugify');
const readline = require('readline');

// Try to import image-size for getting image dimensions
let imageSize = null;
let imageSizeFromFile = null;
try {
  const imageSizeModule = require('image-size');
  imageSize = imageSizeModule.imageSize;
  const imageSizeFromFileModule = require('image-size/fromFile');
  imageSizeFromFile = imageSizeFromFileModule.imageSizeFromFile;
} catch (error) {
  console.warn('Warning: image-size not available. Width/height attributes will not be added to images.');
}

// Import fetch for HTTP requests (for Node.js versions without built-in fetch)
const fetch = (() => {
  try {
    return globalThis.fetch || require('node-fetch');
  } catch {
    console.warn('Warning: fetch not available. Listmonk features disabled.');
    return null;
  }
})();

// Load configuration function
function loadConfig(configFile = null) {
  try {
    if (configFile) {
      // Use specified config file (resolve relative to current working directory)
      const configPath = path.resolve(configFile);
      if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
      }
      // Clear require cache to reload config if needed
      delete require.cache[require.resolve(configPath)];
      return require(configPath);
    } else {
      // Default behavior: try local config first, fall back to example config
      const scriptDir = path.dirname(fs.realpathSync(__filename));
      const localConfigPath = path.join(scriptDir, 'config', 'config.local.js');
      const defaultConfigPath = path.join(scriptDir, 'config', 'example.js');
      const configPath = fs.existsSync(localConfigPath) ? localConfigPath : defaultConfigPath;
      return require(configPath);
    }
  } catch (error) {
    if (configFile) {
      console.error(`Error: Could not load specified config file: ${error.message}`);
      process.exit(1);
    } else {
      console.warn('Warning: Could not load config file. Listmonk features disabled.');
    }
    return {};
  }
}

// Load default configuration
let config = loadConfig();

// Function to get image dimensions
async function getImageDimensions(imageInput, isBuffer = false) {
  if (!imageSize || !imageSizeFromFile) {
    return null;
  }

  try {
    if (isBuffer) {
      // For image buffers
      return imageSize(imageInput);
    } else {
      // For file paths
      if (fs.existsSync(imageInput)) {
        return await imageSizeFromFile(imageInput);
      } else {
        return null;
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not get dimensions for image: ${error.message}`);
    return null;
  }
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
});

function parseFrontmatter(markdownContent) {
  // Check if content starts with YAML frontmatter
  if (!markdownContent.startsWith('---\n')) {
    return {
      frontmatter: {},
      content: markdownContent
    };
  }

  // Find the closing --- delimiter
  const endDelimiterIndex = markdownContent.indexOf('\n---\n', 4);
  if (endDelimiterIndex === -1) {
    // No closing delimiter found, treat as regular markdown
    return {
      frontmatter: {},
      content: markdownContent
    };
  }

  // Extract frontmatter and content
  const frontmatterText = markdownContent.slice(4, endDelimiterIndex);
  const content = markdownContent.slice(endDelimiterIndex + 5);

  try {
    const frontmatter = yaml.load(frontmatterText) || {};
    return {
      frontmatter,
      content
    };
  } catch (error) {
    console.warn('Warning: Failed to parse YAML frontmatter:', error.message);
    return {
      frontmatter: {},
      content: markdownContent
    };
  }
}

async function processFullbleedImages(html, markdownFile = null, imageDimensionsMap = new Map()) {
  // Process images as fullbleed only if they're not already wrapped in links

  // First, temporarily protect linked images by replacing them with placeholders
  const linkedImages = [];
  const linkedImagePlaceholder = '___LINKED_IMG___';

  // Store linked images (both <a><img></a> patterns)
  html = html.replace(/<a[^>]*><img[^>]*><\/a>/g, (match) => {
    linkedImages.push(match);
    return linkedImagePlaceholder;
  });

  // Helper function to build img tag with dimensions
  const buildImgTag = async (src, alt, addClass = true, hasCaption = false) => {
    let imgAttributes = `src="${src}" alt="${alt}"`;
    if (addClass) {
      imgAttributes += hasCaption ? ' class="fullbleed"' : ' class="fullbleed no-caption"';
    }

    // Try to get dimensions for this image
    let dimensions = imageDimensionsMap.get(src);
    if (!dimensions && markdownFile) {
      // Try to get dimensions from local file
      try {
        let imagePath;
        const decodedSrc = decodeURIComponent(src);

        if (config.newsletter?.attachmentsPath && decodedSrc.startsWith('Attachments/')) {
          const relativePath = decodedSrc.replace('Attachments/', '');
          imagePath = path.join(config.newsletter.attachmentsPath, relativePath);
        } else {
          const markdownDir = path.dirname(path.resolve(markdownFile));
          imagePath = path.resolve(markdownDir, decodedSrc);
        }

        dimensions = await getImageDimensions(imagePath);
      } catch (error) {
        // Ignore errors, dimensions will remain null
      }
    }

    if (dimensions) {
      imgAttributes += ` width="${dimensions.width}" height="${dimensions.height}"`;
    }

    return `<img ${imgAttributes} />`;
  };

  // Now process unlinked images for fullbleed treatment
  // Handle images with captions - need to process these asynchronously
  const captionPromises = [];
  const captionMatches = [];
  let captionMatch;
  const captionRegex = /<p><img src="([^"]*)" alt="([^"]*)"[^>]*>(?:\{\.fullbleed\})?\s*\n<em>(.*?)<\/em><\/p>/g;

  while ((captionMatch = captionRegex.exec(html)) !== null) {
    captionMatches.push(captionMatch);
  }

  for (const match of captionMatches) {
    const [fullMatch, src, alt, caption] = match;
    const imgTag = await buildImgTag(src, alt, true, true); // hasCaption = true
    html = html.replace(fullMatch, `${imgTag}<p class="caption">${caption}</p>`);
  }

  // Handle remaining standalone images (both wrapped in <p> tags and unwrapped)
  const standalonePromises = [];
  const standaloneMatches = [];
  let standaloneMatch;
  const standaloneRegex = /<p><img src="([^"]*)" alt="([^"]*)"[^>]*>(?:\{\.fullbleed\})?<\/p>/g;

  while ((standaloneMatch = standaloneRegex.exec(html)) !== null) {
    standaloneMatches.push(standaloneMatch);
  }

  for (const match of standaloneMatches) {
    const [fullMatch, src, alt] = match;
    // Check if this image is followed by a caption paragraph
    const followedByCaption = html.indexOf(`${fullMatch}<p class="caption">`) !== -1;
    const imgTag = await buildImgTag(src, alt, true, followedByCaption);
    html = html.replace(fullMatch, imgTag);
  }

  // Handle any remaining unwrapped standalone images
  const unwrappedMatches = [];
  let unwrappedMatch;
  const unwrappedRegex = /<img src="([^"]*)" alt="([^"]*)"[^>]*>(?:\{\.fullbleed\})?/g;

  while ((unwrappedMatch = unwrappedRegex.exec(html)) !== null) {
    unwrappedMatches.push(unwrappedMatch);
  }

  for (const match of unwrappedMatches) {
    const [fullMatch, src, alt] = match;
    // Skip images that already have the fullbleed class (already processed)
    if (fullMatch.includes('class="fullbleed')) {
      continue;
    }
    // Check if this image is followed by a caption paragraph
    const followedByCaption = html.indexOf(`${fullMatch}<p class="caption">`) !== -1;
    const imgTag = await buildImgTag(src, alt, true, followedByCaption);
    html = html.replace(fullMatch, imgTag);
  }

  // Restore linked images (these will remain unmodified)
  html = html.replace(new RegExp(linkedImagePlaceholder, 'g'), () => linkedImages.shift());

  return html;
}

function processCallouts(html) {
  // Convert blockquotes that start with "Callout:" to callout paragraphs
  // More precise regex that only matches single-paragraph blockquotes
  return html.replace(
    /<blockquote>\s*<p><strong>(?:Callout|CALLOUT|callout):<\/strong>\s*(.*?)<\/p>\s*<\/blockquote>/gi,
    '<p class="callout">$1</p>'
  );
}

function processHighlighting(html) {
  // Convert ==highlighted text== to <span class="highlight">highlighted text</span>
  return html.replace(
    /==([^=]+)==/g,
    '<span class="highlight">$1</span>'
  );
}

// WordPress-specific markdown to HTML conversion pipeline
async function processMarkdownForWordPress(markdownContent, frontmatter, markdownFile = null, imageDimensionsMap = new Map()) {
  // Convert markdown to HTML using MarkdownIt
  let htmlContent = md.render(markdownContent);

  // Apply WordPress-specific processing pipeline
  htmlContent = processHighlighting(htmlContent);
  htmlContent = await processFullbleedImages(htmlContent, markdownFile, imageDimensionsMap);
  htmlContent = processCallouts(htmlContent);
  // Add more processing functions here as needed

  return htmlContent;
}

function processImageLinks(html, frontmatter) {
  // Check if we have the necessary configuration
  if (!config.newsletter?.webUrlBase || !frontmatter.issue) {
    console.log('Skipping image linking: webUrlBase or issue not configured');
    return html;
  }

  const webUrl = `${config.newsletter.webUrlBase}${slugify(frontmatter.subject, { lower: true, strict: true })}`;
  console.log(`Adding image links to: ${webUrl}`);
  
  // Find standalone images (not already in links) and wrap them
  // First, temporarily replace already-linked images to protect them
  const linkedImagePlaceholder = '___LINKED_IMAGE___';
  const linkedImages = [];
  
  // Store existing linked images (including any following caption)
  html = html.replace(/<a[^>]*><img[^>]*class="fullbleed[^"]*"[^>]*><\/a>(?:<p class="caption">[^<]*<\/p>)?/g, (match) => {
    linkedImages.push(match);
    return linkedImagePlaceholder;
  });

  // Wrap standalone fullbleed images with links (including any following caption)
  html = html.replace(
    /<img([^>]*class="fullbleed[^"]*"[^>]*)>(?:<p class="caption">([^<]*)<\/p>)?/g,
    (match, imgAttrs, caption) => {
      console.log(`Wrapping image with link: ${webUrl}`);
      if (caption) {
        return `<a href="${webUrl}"><img${imgAttrs}></a><p class="caption">${caption}</p>`;
      } else {
        return `<a href="${webUrl}"><img${imgAttrs}></a>`;
      }
    }
  );
  
  // Restore the originally linked images
  html = html.replace(new RegExp(linkedImagePlaceholder, 'g'), () => linkedImages.shift());
  
  return html;
}

function processTrackingLinks(html) {
  // Add @TrackLink to all href attributes for Listmonk click tracking
  // Skip links that already have @TrackLink or are Listmonk template variables
  return html.replace(
    /href="([^"]+)"/g,
    (match, url) => {
      // Skip if already has @TrackLink
      if (url.includes('@TrackLink')) {
        return match;
      }
      
      // Skip Listmonk template variables like {{ UnsubscribeURL }}
      if (url.includes('{{') && url.includes('}}')) {
        return match;
      }
      
      // Skip mailto links
      if (url.startsWith('mailto:')) {
        return match;
      }
      
      // Skip anchor links (internal page links)
      if (url.startsWith('#')) {
        return match;
      }
      
      // Add @TrackLink to external URLs
      return `href="${url}@TrackLink"`;
    }
  );
}

function processUtmTracking(html) {
  // Add utm_source parameter to external URLs (not belonging to webUrlDomain)
  if (!config.newsletter?.trafficSource || !config.newsletter?.webUrlDomain) {
    return html;
  }

  const trafficSource = config.newsletter.trafficSource;
  const webUrlDomain = config.newsletter.webUrlDomain;

  return html.replace(
    /href="([^"]+)"/g,
    (match, url) => {
      // Skip if already has utm_source
      if (url.includes('utm_source=')) {
        return match;
      }
      
      // Skip Listmonk template variables like {{ UnsubscribeURL }}
      if (url.includes('{{') && url.includes('}}')) {
        return match;
      }
      
      // Skip mailto links
      if (url.startsWith('mailto:')) {
        return match;
      }
      
      // Skip anchor links (internal page links)
      if (url.startsWith('#')) {
        return match;
      }
      
      // Skip relative URLs
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return match;
      }
      
      // Check if URL belongs to webUrlDomain
      try {
        const urlObj = new URL(url);
        if (urlObj.hostname === webUrlDomain || urlObj.hostname.endsWith(`.${webUrlDomain}`)) {
          return match; // Skip internal domain URLs
        }
      } catch (error) {
        // If URL parsing fails, skip this URL
        return match;
      }
      
      // Add utm_source to external URLs
      const separator = url.includes('?') ? '&' : '?';
      return `href="${url}${separator}utm_source=${encodeURIComponent(trafficSource)}"`;
    }
  );
}

function processUtmTrackingMarkdown(markdownContent) {
  // Add utm_source parameter to external markdown links [text](url)
  if (!config.newsletter?.trafficSource || !config.newsletter?.webUrlDomain) {
    return markdownContent;
  }

  const trafficSource = config.newsletter.trafficSource;
  const webUrlDomain = config.newsletter.webUrlDomain;

  return markdownContent.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (match, text, url) => {
      if (url.includes('utm_source=')) return match;
      if (url.startsWith('mailto:')) return match;
      if (url.startsWith('#')) return match;
      if (!url.startsWith('http://') && !url.startsWith('https://')) return match;

      try {
        const urlObj = new URL(url);
        if (urlObj.hostname === webUrlDomain || urlObj.hostname.endsWith(`.${webUrlDomain}`)) {
          return match;
        }
      } catch (error) {
        return match;
      }

      const separator = url.includes('?') ? '&' : '?';
      return `[${text}](${url}${separator}utm_source=${encodeURIComponent(trafficSource)})`;
    }
  );
}

async function findExistingCampaign(campaignName) {
  if (!fetch) {
    throw new Error('HTTP fetch not available. Please install node-fetch: npm install node-fetch');
  }

  const auth = Buffer.from(`${config.listmonk.username}:${config.listmonk.password}`).toString('base64');
  
  try {
    // Get campaigns with pagination to search through all
    let page = 1;
    const perPage = 100;
    
    while (true) {
      const response = await fetch(`${config.listmonk.baseUrl}/api/campaigns?page=${page}&per_page=${perPage}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Listmonk API error: ${response.status} ${response.statusText}\n${errorText}`);
      }

      const result = await response.json();
      
      // Search for campaign with matching name
      const existingCampaign = result.data.results.find(campaign => campaign.name === campaignName);
      if (existingCampaign) {
        return existingCampaign;
      }
      
      // Check if we've reached the end
      if (result.data.results.length < perPage) {
        break;
      }
      
      page++;
    }
    
    return null; // No matching campaign found
  } catch (error) {
    throw new Error(`Failed to search for existing campaign: ${error.message}`);
  }
}

async function updateListmonkCampaign(campaignId, htmlContent, markdownContent, options = {}) {
  if (!fetch) {
    throw new Error('HTTP fetch not available. Please install node-fetch: npm install node-fetch');
  }

  const campaignData = {
    ...config.listmonk.campaign,
    ...options,
    body: htmlContent,
    altbody: markdownContent
  };

  // Add prefix to subject if both prefix and subject exist
  if (config.listmonk.campaign.prefix && campaignData.subject) {
    campaignData.subject = `${config.listmonk.campaign.prefix} ${campaignData.subject}`;
  }

  const auth = Buffer.from(`${config.listmonk.username}:${config.listmonk.password}`).toString('base64');
  
  try {
    const response = await fetch(`${config.listmonk.baseUrl}/api/campaigns/${campaignId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(campaignData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Listmonk API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    throw new Error(`Failed to update campaign: ${error.message}`);
  }
}

async function createListmonkCampaign(htmlContent, markdownContent, options = {}) {
  if (!config.listmonk) {
    throw new Error('Listmonk configuration not found. Please check your config file.');
  }

  if (!fetch) {
    throw new Error('HTTP fetch not available. Please install node-fetch: npm install node-fetch');
  }

  const campaignData = {
    ...config.listmonk.campaign,
    ...options,
    body: htmlContent,
    altbody: markdownContent
  };

  // Add prefix to subject if both prefix and subject exist
  if (config.listmonk.campaign.prefix && campaignData.subject) {
    campaignData.subject = `${config.listmonk.campaign.prefix} ${campaignData.subject}`;
  }

  const auth = Buffer.from(`${config.listmonk.username}:${config.listmonk.password}`).toString('base64');
  
  try {
    const response = await fetch(`${config.listmonk.baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(campaignData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Listmonk API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    throw new Error(`Failed to create campaign: ${error.message}`);
  }
}

async function createOrUpdateListmonkCampaign(htmlContent, markdownContent, options = {}) {
  const campaignName = options.name || config.listmonk.campaign.name;
  
  try {
    // Check if campaign already exists
    console.log(`Checking for existing campaign: "${campaignName}"`);
    const existingCampaign = await findExistingCampaign(campaignName);
    
    if (existingCampaign) {
      console.log(`Found existing campaign (ID: ${existingCampaign.id}, Status: ${existingCampaign.status})`);
      
      if (existingCampaign.status === 'draft') {
        console.log('Campaign is in draft status - updating with new content...');
        const result = await updateListmonkCampaign(existingCampaign.id, htmlContent, markdownContent, options);
        return { ...result, action: 'updated' };
      } else {
        console.log(`Campaign status is "${existingCampaign.status}" - creating new campaign...`);
        const result = await createListmonkCampaign(htmlContent, markdownContent, options);
        return { ...result, action: 'created' };
      }
    } else {
      console.log('No existing campaign found - creating new campaign...');
      const result = await createListmonkCampaign(htmlContent, markdownContent, options);
      return { ...result, action: 'created' };
    }
  } catch (error) {
    throw new Error(`Failed to create or update campaign: ${error.message}`);
  }
}

async function downloadImage(imageUrl) {
  if (!fetch) {
    throw new Error('HTTP fetch not available. Please install node-fetch: npm install node-fetch');
  }

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    // Handle different fetch implementations (built-in vs node-fetch)
    let buffer;
    if (typeof response.buffer === 'function') {
      // node-fetch
      buffer = await response.buffer();
    } else if (typeof response.arrayBuffer === 'function') {
      // Built-in fetch (Node.js 18+)
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      throw new Error('Unable to extract buffer from response');
    }
    
    const contentType = response.headers.get('content-type');
    
    return {
      buffer,
      contentType,
      size: buffer.length
    };
  } catch (error) {
    throw new Error(`Failed to download image from ${imageUrl}: ${error.message}`);
  }
}

async function findExistingWordPressImage(wp, filename) {
  try {
    // Search for media items by filename (slug)
    const mediaItems = await wp.media().param('per_page', 100);
    
    // Look for match by checking the slug (which is based on filename)
    const filenameWithoutExt = path.parse(filename).name;
    
    for (const item of mediaItems) {
      // WordPress may append file extension and numbers, so check if slug starts with our filename
      if (item.slug.startsWith(filenameWithoutExt)) {
        console.log(`Found existing WordPress image: ${item.source_url}`);
        return {
          id: item.id,
          url: item.source_url,
          filename: item.media_details?.file || filename
        };
      }
    }
    return null;
  } catch (error) {
    // If search fails, continue with upload
    console.warn(`Warning: Could not search for existing images: ${error.message}`);
    return null;
  }
}

async function uploadImageToWordPress(imageBuffer, filename, contentType, altText = '') {
  if (!config.wordpress) {
    throw new Error('WordPress configuration not found. Please check your config file.');
  }

  try {
    const WPAPI = require('wpapi');
    const os = require('os');
    
    // Initialize WordPress API client
    const wp = new WPAPI({
      endpoint: `${config.wordpress.baseUrl}/wp-json`,
      username: config.wordpress.username,
      password: config.wordpress.password
    });

    // Check if this image already exists in WordPress by filename
    const existingImage = await findExistingWordPressImage(wp, filename);
    if (existingImage) {
      return existingImage;
    }

    // Create a temporary file
    const tempFilePath = path.join(os.tmpdir(), filename);
    fs.writeFileSync(tempFilePath, imageBuffer);

    try {
      // Upload the file using wpapi with file path
      const result = await wp.media().file(tempFilePath).create({
        title: filename,
        alt_text: altText,
        media_type: 'image'
      });

      return {
        id: result.id,
        url: result.source_url,
        filename: result.media_details?.file || filename
      };
    } finally {
      // Clean up temporary file
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.warn(`Warning: Failed to clean up temporary file: ${tempFilePath}`);
      }
    }
  } catch (error) {
    throw new Error(`Failed to upload image to WordPress: ${error.message}`);
  }
}

function getImageExtension(contentType, url) {
  // Try to get extension from content type first
  if (contentType) {
    const typeMap = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg', 
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp'
    };
    const ext = typeMap[contentType.toLowerCase()];
    if (ext) return ext;
  }
  
  // Fallback to URL extension
  const urlExt = path.extname(url).toLowerCase().slice(1);
  if (config.wordpress?.images?.allowedTypes?.includes(urlExt)) {
    return urlExt;
  }
  
  // Default fallback
  return 'jpg';
}

function generateImageFilename(originalUrl, prefix = 'newsletter-') {
  // Create a hash of the URL for uniqueness (deterministic, no timestamp)
  const hash = crypto.createHash('md5').update(originalUrl).digest('hex').slice(0, 12);
  return `${prefix}${hash}`;
}

async function processImagesForWordPress(markdownContent, markdownFile, options = {}) {
  if (!options.uploadImages || !config.wordpress) {
    return { processedContent: markdownContent, imageDimensionsMap: new Map() };
  }

  console.log('Processing images for WordPress upload...');

  // Regular expression to find all markdown images
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images = [];
  let match;

  // Find all images in the markdown
  while ((match = imageRegex.exec(markdownContent)) !== null) {
    const [fullMatch, altText, imageUrl] = match;
    images.push({ fullMatch, altText, imageUrl, index: match.index });
  }

  if (images.length === 0) {
    console.log('No images found in markdown.');
    return { processedContent: markdownContent, imageDimensionsMap: new Map() };
  }

  console.log(`Found ${images.length} image(s) to process...`);

  let processedContent = markdownContent;
  const uploadedImages = new Map();
  const imageDimensionsMap = new Map();

  // Process images in reverse order to maintain string indices
  for (let i = images.length - 1; i >= 0; i--) {
    const { fullMatch, altText, imageUrl } = images[i];

    try {
      // Skip if already processed (same URL used multiple times)
      if (uploadedImages.has(imageUrl)) {
        const newUrl = uploadedImages.get(imageUrl);
        const newImageMarkdown = `![${altText}](${newUrl})`;
        processedContent = processedContent.replace(fullMatch, newImageMarkdown);
        continue;
      }

      console.log(`Processing image: ${imageUrl}`);

      let imageBuffer, contentType, dimensions = null;

      if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        // Download remote image
        const downloadResult = await downloadImage(imageUrl);
        imageBuffer = downloadResult.buffer;
        contentType = downloadResult.contentType;

        // Check file size
        if (config.wordpress.images?.maxSizeBytes && downloadResult.size > config.wordpress.images.maxSizeBytes) {
          console.warn(`Image ${imageUrl} is too large (${downloadResult.size} bytes), skipping...`);
          continue;
        }

        // Get dimensions from buffer
        dimensions = await getImageDimensions(imageBuffer, true);
      } else {
        // Read local image file
        let imagePath;

        // Decode URL-encoded characters (like %20 for spaces)
        const decodedImageUrl = decodeURIComponent(imageUrl);

        // If attachmentsPath is configured and image starts with 'Attachments/', use it
        if (config.newsletter?.attachmentsPath && decodedImageUrl.startsWith('Attachments/')) {
          const relativePath = decodedImageUrl.replace('Attachments/', '');
          imagePath = path.join(config.newsletter.attachmentsPath, relativePath);
          console.log(`Using configured attachments path: ${imagePath}`);
        } else {
          // Default: resolve relative to the markdown file's actual location
          const markdownDir = path.dirname(path.resolve(markdownFile));
          imagePath = path.resolve(markdownDir, decodedImageUrl);
          console.log(`Using relative path from markdown: ${imagePath}`);
        }

        if (!fs.existsSync(imagePath)) {
          console.warn(`Local image not found: ${imagePath}, skipping...`);
          console.log(`  Markdown file: ${markdownFile}`);
          console.log(`  Original image URL: ${imageUrl}`);
          console.log(`  Decoded image URL: ${decodedImageUrl}`);
          console.log(`  Resolved path: ${imagePath}`);
          continue;
        }

        imageBuffer = fs.readFileSync(imagePath);

        // Get dimensions from file
        dimensions = await getImageDimensions(imagePath);

        // Determine content type from file extension
        const ext = path.extname(imageUrl).toLowerCase().slice(1);
        const typeMap = {
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'gif': 'image/gif',
          'webp': 'image/webp'
        };
        contentType = typeMap[ext] || 'image/jpeg';
      }

      // Generate filename
      const extension = getImageExtension(contentType, imageUrl);
      const baseFilename = generateImageFilename(imageUrl, config.wordpress.images?.prefix);
      const filename = `${baseFilename}.${extension}`;

      // Upload to WordPress with alt text from markdown
      console.log(`Uploading to WordPress as: ${filename}`);
      const uploadResult = await uploadImageToWordPress(imageBuffer, filename, contentType, altText);

      console.log(`Successfully uploaded: ${uploadResult.url}`);

      // Store the mapping and dimensions
      uploadedImages.set(imageUrl, uploadResult.url);
      if (dimensions) {
        imageDimensionsMap.set(uploadResult.url, dimensions);
        console.log(`  Dimensions: ${dimensions.width}x${dimensions.height}`);
      }

      // Replace in markdown
      const newImageMarkdown = `![${altText}](${uploadResult.url})`;
      processedContent = processedContent.replace(fullMatch, newImageMarkdown);

    } catch (error) {
      console.error(`Failed to process image ${imageUrl}:`, error.message);
      // Continue with next image rather than failing completely
    }
  }

  console.log(`Image processing complete. Uploaded ${uploadedImages.size} image(s).`);
  return { processedContent, imageDimensionsMap };
}


async function findExistingWordPressPost(slug) {
  if (!config.wordpress) {
    throw new Error('WordPress configuration not found. Please check your config file.');
  }

  if (!fetch) {
    throw new Error('HTTP fetch not available. Please install node-fetch: npm install node-fetch');
  }

  try {
    const auth = Buffer.from(`${config.wordpress.username}:${config.wordpress.password}`).toString('base64');
    
    // Search for posts with all statuses (including drafts)
    const response = await fetch(`${config.wordpress.baseUrl}/wp-json/wp/v2/newsletters?slug=${slug}&per_page=1&status=any`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WordPress API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const posts = await response.json();
    
    console.log(`Search results for slug "${slug}":`, posts.length > 0 ? `Found ${posts.length} post(s)` : 'No posts found');
    
    if (posts.length > 0) {
      console.log(`Found existing WordPress letter post: ${posts[0].title.rendered} (ID: ${posts[0].id}, Status: ${posts[0].status})`);
      return posts[0];
    }
    
    return null; // No matching post found
  } catch (error) {
    throw new Error(`Failed to search for existing WordPress post: ${error.message}`);
  }
}

async function findOrCreateCategory(categoryName) {
  if (!config.wordpress) {
    throw new Error('WordPress configuration not found. Please check your config file.');
  }

  if (!fetch) {
    throw new Error('HTTP fetch not available. Please install node-fetch: npm install node-fetch');
  }

  try {
    const auth = Buffer.from(`${config.wordpress.username}:${config.wordpress.password}`).toString('base64');
    const categorySlug = slugify(categoryName, { lower: true, strict: true });
    
    // First, try to find existing category by slug
    const searchResponse = await fetch(`${config.wordpress.baseUrl}/wp-json/wp/v2/categories?slug=${categorySlug}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    if (searchResponse.ok) {
      const categories = await searchResponse.json();
      if (categories.length > 0) {
        console.log(`Found existing category: ${categories[0].name} (ID: ${categories[0].id})`);
        return categories[0].id;
      }
    }
    
    // Category doesn't exist, create it
    console.log(`Creating new category: ${categoryName}`);
    const createResponse = await fetch(`${config.wordpress.baseUrl}/wp-json/wp/v2/categories`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: categoryName,
        slug: categorySlug
      })
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create category: ${createResponse.status} ${createResponse.statusText}\n${errorText}`);
    }

    const newCategory = await createResponse.json();
    console.log(`Created new category: ${newCategory.name} (ID: ${newCategory.id})`);
    return newCategory.id;
  } catch (error) {
    throw new Error(`Failed to find or create category: ${error.message}`);
  }
}

async function createWordPressPost(slug, title, markdownContent, frontmatter, markdownFile = null, imageDimensionsMap = new Map()) {
  if (!config.wordpress) {
    throw new Error('WordPress configuration not found. Please check your config file.');
  }

  if (!fetch) {
    throw new Error('HTTP fetch not available. Please install node-fetch: npm install node-fetch');
  }

  try {
    const auth = Buffer.from(`${config.wordpress.username}:${config.wordpress.password}`).toString('base64');

    // Process content based on contentFormat config (default to 'markdown')
    const contentFormat = config.wordpress.contentFormat || 'markdown';
    let processedContent;

    if (contentFormat === 'html') {
      processedContent = await processMarkdownForWordPress(markdownContent, frontmatter, markdownFile, imageDimensionsMap);
    } else {
      processedContent = processUtmTrackingMarkdown(markdownContent);
    }

    const postData = {
      title: title,
      slug: slug,
      status: 'draft',
      acf: {
        newsletter_content: processedContent,
        newsletter_issue: frontmatter.issue,
        newsletter_description: frontmatter.description
      }
    };

    // Add category based on config newsletter title
    if (config.newsletter?.title) {
      const categoryId = await findOrCreateCategory(config.newsletter.title);
      postData.categories = [categoryId];
    }

    // Add any additional frontmatter fields to ACF if they exist
    if (frontmatter.newsletter_title) {
      postData.acf.newsletter_title = frontmatter.newsletter_title;
    }
    if (frontmatter.subject) {
      postData.acf.subject = frontmatter.subject;
    }

    const response = await fetch(`${config.wordpress.baseUrl}/wp-json/wp/v2/newsletters`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(postData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WordPress API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    throw new Error(`Failed to create WordPress post: ${error.message}`);
  }
}

async function updateWordPressPost(postId, title, markdownContent, frontmatter, markdownFile = null, imageDimensionsMap = new Map()) {
  if (!config.wordpress) {
    throw new Error('WordPress configuration not found. Please check your config file.');
  }

  if (!fetch) {
    throw new Error('HTTP fetch not available. Please install node-fetch: npm install node-fetch');
  }

  try {
    const auth = Buffer.from(`${config.wordpress.username}:${config.wordpress.password}`).toString('base64');

    // Process content based on contentFormat config (default to 'markdown')
    const contentFormat = config.wordpress.contentFormat || 'markdown';
    let processedContent;

    if (contentFormat === 'html') {
      processedContent = await processMarkdownForWordPress(markdownContent, frontmatter, markdownFile, imageDimensionsMap);
    } else {
      processedContent = processUtmTrackingMarkdown(markdownContent);
    }

    const postData = {
      title: title,
      acf: {
        newsletter_content: processedContent,
        newsletter_issue: frontmatter.issue,
        newsletter_description: frontmatter.description
      }
    };

    // Add category based on config newsletter title
    if (config.newsletter?.title) {
      const categoryId = await findOrCreateCategory(config.newsletter.title);
      postData.categories = [categoryId];
    }

    // Add any additional frontmatter fields to ACF if they exist
    if (frontmatter.newsletter_title) {
      postData.acf.newsletter_title = frontmatter.newsletter_title;
    }
    if (frontmatter.subject) {
      postData.acf.subject = frontmatter.subject;
    }

    const response = await fetch(`${config.wordpress.baseUrl}/wp-json/wp/v2/newsletters/${postId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(postData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WordPress API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    throw new Error(`Failed to update WordPress post: ${error.message}`);
  }
}

// Helper function to prompt user for input
async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function createOrUpdateWordPressPost(slug, title, markdownContent, frontmatter, markdownFile = null, imageDimensionsMap = new Map()) {
  try {
    // Check if post already exists
    console.log(`Checking for existing WordPress letter post with slug: "${slug}"`);
    const existingPost = await findExistingWordPressPost(slug);

    if (existingPost) {
      console.log(`Found existing post (ID: ${existingPost.id}, Status: ${existingPost.status})`);

      if (existingPost.status === 'draft') {
        console.log('Post is in draft status - updating with new content...');
        const result = await updateWordPressPost(existingPost.id, title, markdownContent, frontmatter, markdownFile, imageDimensionsMap);
        return { ...result, action: 'updated' };
      } else {
        // Post is published or in another status - ask user what to do
        console.log(`\nPost status is "${existingPost.status}".`);
        console.log(`Options:`);
        console.log(`  1. Update the existing ${existingPost.status} post`);
        console.log(`  2. Create a new post (leaves the existing post unchanged)`);

        const choice = await promptUser('\nWhat would you like to do? (1/2): ');

        if (choice === '1' || choice === 'update') {
          console.log('Updating the existing post...');
          const result = await updateWordPressPost(existingPost.id, title, markdownContent, frontmatter, markdownFile, imageDimensionsMap);
          return { ...result, action: 'updated' };
        } else {
          console.log('Creating a new post...');
          const result = await createWordPressPost(slug, title, markdownContent, frontmatter, markdownFile, imageDimensionsMap);
          return { ...result, action: 'created' };
        }
      }
    } else {
      console.log('No existing post found - creating new post...');
      const result = await createWordPressPost(slug, title, markdownContent, frontmatter, markdownFile, imageDimensionsMap);
      return { ...result, action: 'created' };
    }
  } catch (error) {
    throw new Error(`Failed to create or update WordPress post: ${error.message}`);
  }
}

async function compileEmail(markdownFile, templateFile, outputFile, options = {}) {
  try {
    // Reload config if a specific config file is specified
    if (options.configFile) {
      config = loadConfig(options.configFile);
    }

    const rawMarkdownContent = fs.readFileSync(markdownFile, 'utf8');
    const templateContent = fs.readFileSync(templateFile, 'utf8');

    // Parse frontmatter and extract clean content
    const { frontmatter, content: cleanMarkdownContent } = parseFrontmatter(rawMarkdownContent);

    // Show parsed frontmatter if any
    if (Object.keys(frontmatter).length > 0) {
      console.log('Parsed frontmatter:', JSON.stringify(frontmatter, null, 2));
    }

    // Process images for WordPress upload if enabled
    const { processedContent: processedMarkdownContent, imageDimensionsMap } = await processImagesForWordPress(cleanMarkdownContent, markdownFile, options);

    // Process frontmatter for campaign options
    const frontmatterCampaignOptions = {};

    // Construct automatic title from newsletter_title + issue
    if (frontmatter.newsletter_title && frontmatter.issue) {
      frontmatterCampaignOptions.name = `${frontmatter.newsletter_title} ${frontmatter.issue}`;
    } else if (frontmatter.title) {
      frontmatterCampaignOptions.name = frontmatter.title;
    }

    if (frontmatter.subject) frontmatterCampaignOptions.subject = frontmatter.subject;
    if (frontmatter.from_email) frontmatterCampaignOptions.from_email = frontmatter.from_email;
    if (frontmatter.lists) frontmatterCampaignOptions.lists = frontmatter.lists;
    if (frontmatter.tags) frontmatterCampaignOptions.tags = frontmatter.tags;
    if (frontmatter.template_id) frontmatterCampaignOptions.template_id = frontmatter.template_id;

    // Merge frontmatter options with command-line options (CLI takes priority)
    const mergedCampaignOptions = {
      ...frontmatterCampaignOptions,
      ...options.campaignOptions
    };

    let htmlContent = md.render(processedMarkdownContent);
    htmlContent = processHighlighting(htmlContent);
    htmlContent = await processFullbleedImages(htmlContent, markdownFile, imageDimensionsMap);
    htmlContent = processCallouts(htmlContent);
    htmlContent = processImageLinks(htmlContent, frontmatter);
    htmlContent = processUtmTracking(htmlContent);
    htmlContent = processTrackingLinks(htmlContent);

    let fullHTML = templateContent.replace('{{content}}', htmlContent);

    // Replace template variables with frontmatter values
    if (frontmatter.newsletter_title) {
      fullHTML = fullHTML.replace(/\{\{newsletter_title\}\}/g, frontmatter.newsletter_title);
    }
    if (frontmatter.issue) {
      fullHTML = fullHTML.replace(/\{\{issue\}\}/g, frontmatter.issue);
    }
    if (frontmatter.description) {
      fullHTML = fullHTML.replace(/\{\{description\}\}/g, frontmatter.description);
    }
    if (frontmatter.subject) {
      const slug = slugify(frontmatter.subject, { lower: true, strict: true });
      fullHTML = fullHTML.replace(/\{\{slug\}\}/g, slug);
    }

    const inlinedHTML = await inlineCSS(fullHTML, {
      url: 'file://' + path.dirname(path.resolve(templateFile)) + '/',
      preserveMediaQueries: true,
      removeStyleTags: false,
      removeLinkTags: false
    });

    const minifiedHTML = await minify(inlinedHTML, {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      useShortDoctype: true,
      minifyCSS: true,
      minifyJS: true,
      removeEmptyAttributes: true,
      removeOptionalTags: false,
      preserveLineBreaks: false
    });

    if (outputFile) {
      fs.writeFileSync(outputFile, minifiedHTML);
      console.log(`Email HTML compiled and minified successfully: ${outputFile}`);
    }

    // Create or update Listmonk campaign if requested
    if (options.createCampaign) {
      try {
        const campaign = await createOrUpdateListmonkCampaign(minifiedHTML, processedMarkdownContent, mergedCampaignOptions);

        if (campaign.action === 'updated') {
          console.log(`Campaign updated successfully! Campaign ID: ${campaign.data.id}`);
          console.log(`Campaign name: ${campaign.data.name}`);
          console.log(`Status: ${campaign.data.status}`);
          console.log(`Updated with new content and plaintext alternative`);
        } else {
          console.log(`Campaign created successfully! Campaign ID: ${campaign.data.id}`);
          console.log(`Campaign name: ${campaign.data.name}`);
          console.log(`Status: ${campaign.data.status}`);
          console.log(`Includes plaintext alternative from markdown source`);
        }
      } catch (error) {
        console.error('Failed to create or update campaign:', error.message);
        process.exit(1);
      }
    }

    // Create or update WordPress post if requested
    if (options.createWordPressPost) {
      try {
        const slug = slugify(frontmatter.subject, { lower: true, strict: true });
        const title = frontmatter.subject
          || frontmatter.title
          || (frontmatter.newsletter_title && frontmatter.issue ? `${frontmatter.newsletter_title} ${frontmatter.issue}` : null)
          || 'Newsletter';

        const post = await createOrUpdateWordPressPost(slug, title, processedMarkdownContent, frontmatter, markdownFile, imageDimensionsMap);

        if (post.action === 'updated') {
          console.log(`WordPress post updated successfully! Post ID: ${post.id}`);
          console.log(`Post title: ${post.title.rendered}`);
          console.log(`Status: ${post.status}`);
          console.log(`Slug: ${post.slug}`);
          console.log(`Updated with new markdown content in ACF newsletter_content field`);
        } else {
          console.log(`WordPress post created successfully! Post ID: ${post.id}`);
          console.log(`Post title: ${post.title.rendered}`);
          console.log(`Status: ${post.status}`);
          console.log(`Slug: ${post.slug}`);
          console.log(`Markdown content stored in ACF newsletter_content field`);
        }
      } catch (error) {
        console.error('Failed to create or update WordPress post:', error.message);
        process.exit(1);
      }
    }

    if (!outputFile && !options.createCampaign && !options.createWordPressPost) {
      console.log(minifiedHTML);
    }

    return minifiedHTML;
  } catch (error) {
    console.error('Error compiling email:', error.message);
    process.exit(1);
  }
}

function showUsage() {
  console.log(`
Usage: node compile-email.js <markdown-file> <template-file> [output-file] [options]

Arguments:
  markdown-file   Path to the markdown file to convert
  template-file   Path to the HTML template file (should contain {{content}} placeholder)
  output-file     Optional: Path to save the compiled HTML (if not provided, outputs to stdout)

Options:
  --config <file>             Specify custom config file (overrides default config/config.local.js)
  --create-campaign           Create a Listmonk campaign with the compiled email
  --upload-images             Upload images to WordPress and replace URLs
  --create-wordpress-post     Create/update WordPress custom post type 'letter' with newsletter content
  --campaign-name <name>      Campaign name (overrides config default)
  --campaign-subject <subj>   Campaign subject (overrides config default)
  --campaign-lists <ids>      Comma-separated list IDs (overrides config default)

Examples:
  node compile-email.js newsletter.md template.html output.html
  node compile-email.js newsletter.md template.html --upload-images
  node compile-email.js newsletter.md template.html --create-campaign
  node compile-email.js newsletter.md template.html --config config.production.js --create-campaign
  node compile-email.js newsletter.md template.html --create-wordpress-post
  node compile-email.js newsletter.md template.html --upload-images --create-campaign --create-wordpress-post
  node compile-email.js newsletter.md template.html --upload-images --create-campaign --campaign-name "Weekly Update" --campaign-subject "This Week's News"

Campaign Management:
  - If no campaign exists with the name → Creates new campaign
  - If campaign exists and is in 'draft' status → Updates with new content  
  - If campaign exists but is 'sent', 'scheduled', etc. → Creates new campaign

WordPress Post Management:
  - Creates custom post type 'letter' with slug from frontmatter 'issue' field
  - Stores markdown content in ACF field 'newsletter_content'
  - If post exists and is 'draft' → Updates with new content
  - If post exists but is 'published', etc. → Creates new post
  - Requires 'issue' field in markdown frontmatter
  `);
}

// Check if this file is being run directly (handles symlinks properly)
if (require.main === module || fs.realpathSync(require.main.filename) === fs.realpathSync(__filename)) {
  const args = process.argv.slice(2);
  
  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    showUsage();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }
  
  // Parse config file option first
  const configIndex = args.indexOf('--config');
  let configFile = null;
  if (configIndex !== -1 && args[configIndex + 1]) {
    configFile = args[configIndex + 1];
  }
  
  // Parse arguments and options - exclude option values from non-option args
  const optionValues = [];
  if (configFile) optionValues.push(configFile);
  
  // Check for other option values
  const nameIndex = args.indexOf('--campaign-name');
  if (nameIndex !== -1 && args[nameIndex + 1]) optionValues.push(args[nameIndex + 1]);
  
  const subjectIndex = args.indexOf('--campaign-subject');
  if (subjectIndex !== -1 && args[subjectIndex + 1]) optionValues.push(args[subjectIndex + 1]);
  
  const listsIndex = args.indexOf('--campaign-lists');
  if (listsIndex !== -1 && args[listsIndex + 1]) optionValues.push(args[listsIndex + 1]);
  
  const nonOptionArgs = args.filter(arg => !arg.startsWith('--') && !optionValues.includes(arg));
  const [markdownFile, templateFile, outputFile] = nonOptionArgs;
  
  // Parse options
  const options = {
    createCampaign: args.includes('--create-campaign'),
    uploadImages: args.includes('--upload-images'),
    createWordPressPost: args.includes('--create-wordpress-post'),
    campaignOptions: {},
    configFile: configFile
  };
  
  // Parse campaign-specific options (using already found indices)
  if (nameIndex !== -1 && args[nameIndex + 1]) {
    options.campaignOptions.name = args[nameIndex + 1];
  }
  
  if (subjectIndex !== -1 && args[subjectIndex + 1]) {
    options.campaignOptions.subject = args[subjectIndex + 1];
  }
  
  if (listsIndex !== -1 && args[listsIndex + 1]) {
    options.campaignOptions.lists = args[listsIndex + 1].split(',').map(id => parseInt(id.trim()));
  }
  
  compileEmail(markdownFile, templateFile, outputFile, options);
}

module.exports = {
  compileEmail,
  parseFrontmatter,
  processCallouts,
  processHighlighting,
  processFullbleedImages,
  processImageLinks,
  processTrackingLinks,
  processUtmTracking,
  processUtmTrackingMarkdown,
  loadConfig,
};