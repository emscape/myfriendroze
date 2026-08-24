// Hand-curated gallery for myfriendroze.
// No third-party Instagram integration — add a photo here whenever you post
// one worth sharing on the site. Zero vendor cost, no view caps, no tokens.
//
// To add a photo:
// 1. Drop the image file in astro/public/gallery/ (e.g. blue-branches-01.jpg)
// 2. Add an entry below pointing at it.

/**
 * @typedef {{
 *   id: string,
 *   src: string,
 *   alt: string,
 *   caption: string|null,
 *   link: string|null
 * }} GalleryPhoto
 */

/** @type {GalleryPhoto[]} */
export const galleryPhotos = [];
