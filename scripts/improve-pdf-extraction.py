#!/usr/bin/env python3
"""
Improve PDF extraction to get full prompts
"""

import json
import sys
import os

def extract_full_prompts(pdf_path):
    """Extract complete prompts from PDF"""
    try:
        import pdfplumber
        
        gallery_data = []
        
        with pdfplumber.open(pdf_path) as pdf:
            print(f"📄 Processing {len(pdf.pages)} pages...")
            
            for page_num, page in enumerate(pdf.pages, 1):
                text = page.extract_text()
                
                if text and len(text.strip()) > 20:
                    # Get all text from the page
                    full_text = text.strip()
                    
                    # Look for the longest meaningful text block (likely the prompt)
                    lines = [line.strip() for line in full_text.split('\n') if line.strip()]
                    
                    # Combine lines that look like a prompt (longer text blocks)
                    prompt_parts = []
                    for line in lines:
                        if len(line) > 30:  # Likely part of a prompt
                            prompt_parts.append(line)
                    
                    if prompt_parts:
                        # Join all prompt parts
                        full_prompt = ' '.join(prompt_parts)
                        
                        # Clean up the prompt
                        full_prompt = full_prompt.replace('\n', ' ').replace('  ', ' ').strip()
                        
                        # Limit prompt length to reasonable size (first 500 chars)
                        if len(full_prompt) > 500:
                            full_prompt = full_prompt[:500] + "..."
                        
                        # Check if page has images
                        images = page.images
                        has_image = len(images) > 0
                        
                        if full_prompt and len(full_prompt) > 50:  # Only add if meaningful prompt
                            entry = {
                                "id": f"pdf-{page_num}",
                                "prompt": full_prompt,
                                "imageUrl": f"/data/images/page_{page_num:03d}.png" if has_image else "",
                                "model": "Nano Banana Pro",
                                "aspectRatio": "16:9",
                                "author": "pdf_import"
                            }
                            gallery_data.append(entry)
                            print(f"✅ Page {page_num}: Extracted prompt ({len(full_prompt)} chars)")
        
        return gallery_data
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return []

if __name__ == "__main__":
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else "klint_image.pdf"
    output_path = "public/data/klint-community-gallery.json"
    
    if not os.path.exists(pdf_path):
        print(f"❌ PDF file not found: {pdf_path}")
        sys.exit(1)
    
    print(f"🔍 Extracting full prompts from: {pdf_path}")
    data = extract_full_prompts(pdf_path)
    
    if data:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        with open(output_path, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"\n✅ Extracted {len(data)} entries with full prompts")
        print(f"📝 Saved to: {output_path}")
    else:
        print("❌ No data extracted")

