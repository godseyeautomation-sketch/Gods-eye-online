// No Supabase dependency - using dynamic Unsplash images only

export interface KlintProImage {
  id: string;
  url: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  createdAt: string;
  userId?: string;
}

/**
 * Fetch beautiful dynamic images for Klint Studio Gallery
 * First tries to load from JSON data file, then falls back to mock images
 */
export const getKlintProGallery = async (limit: number = 20): Promise<KlintProImage[]> => {
  let jsonImages: KlintProImage[] = [];
  
  try {
    // Try to load from JSON data file (in public folder)
    const response = await fetch('/data/klint-community-gallery.json');
    if (response.ok) {
      const data = await response.json();
      console.log('📄 JSON data loaded:', data);
      if (data && Array.isArray(data) && data.length > 0) {
        jsonImages = data.map((item: any) => {
          // Extract page number from id (e.g., "pdf-5" -> 5)
          let imageUrl = item.imageUrl || item.url || '';
          if (!imageUrl && item.id) {
            const pageMatch = item.id.match(/pdf-(\d+)/);
            if (pageMatch) {
              const pageNum = pageMatch[1].padStart(3, '0');
              imageUrl = `/data/images/page_${pageNum}.png`;
            }
          }
          
          return {
            id: item.id || `klint-${Date.now()}-${Math.random()}`,
            url: imageUrl,
            prompt: item.prompt || '',
            model: item.model || 'klint-studio',
            aspectRatio: item.aspectRatio || '16:9',
            createdAt: item.createdAt || new Date().toISOString(),
            userId: item.author || undefined
          };
        }).filter(item => item.prompt); // Only filter by prompt, not url (we'll handle missing images in UI)
        
        console.log('✅ JSON images found:', jsonImages.length);
        
        // If we have JSON images, return ALL of them (no limit, no mock images)
        if (jsonImages.length > 0) {
          console.log('🖼️ Returning all', jsonImages.length, 'JSON images');
          return jsonImages; // Return all JSON images without limit
        }
      }
    } else {
      console.log('⚠️ JSON file not found or invalid');
    }
  } catch (error) {
    console.log('⚠️ Could not load gallery data file:', error);
  }
  
  // Only use mock images if no JSON images found
  const mockImages = getMockKlintProImages(limit);
  console.log('🖼️ Using mock images only:', mockImages.length);
  return mockImages;
};

/**
 * Beautiful dynamic images for Klint Studio Gallery
 * Using reliable image sources with fallbacks
 */
const getMockKlintProImages = (limit: number): KlintProImage[] => {
  const prompts = [
    'Serene mountain landscape at golden hour',
    'Modern minimalist architecture',
    'Abstract geometric art in vibrant colors',
    'Futuristic cityscape with neon lights',
    'Tropical paradise with crystal waters',
    'Cosmic nebula with stars and galaxies',
    'Magical forest with ethereal lighting',
    'Elegant portrait with dramatic shadows',
    'Cyberpunk street scene at night',
    'Surreal landscape with floating elements',
    'Japanese garden with cherry blossoms',
    'Modern architectural masterpiece',
    'Underwater scene with colorful coral reefs',
    'Steampunk airship in Victorian sky',
    'Fantasy realm with mystical creatures',
    'Vintage car in retro setting',
    'Space station orbiting distant planet',
    'Gothic cathedral with dramatic lighting',
    'Sci-fi laboratory with advanced technology',
    'Minimalist design with clean lines'
  ];

  return Array.from({ length: Math.min(limit, prompts.length) }, (_, i) => {
    // Use Picsum Photos with unique random seeds for each image
    // This ensures reliable loading and variety
    const randomId = 1000 + i * 17; // Unique ID for each image
    return {
      id: `klint-studio-${i + 1}`,
      url: `https://picsum.photos/600/800?random=${randomId}`,
      prompt: prompts[i],
      model: 'klint-studio',
      aspectRatio: '3:4',
      createdAt: new Date(Date.now() - i * 86400000).toISOString(),
      userId: undefined
    };
  });
};

