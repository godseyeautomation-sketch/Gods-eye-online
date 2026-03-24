
import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full text-black">
      <div className="bg-brand text-bg px-8 py-16">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-12 gap-12">
          
          {/* Main Headline */}
          <div className="md:col-span-3">
            <h2 className="text-3xl md:text-4xl font-bold uppercase leading-tight tracking-tight">
              Powered<br/>
              Camera Control<br/>
              For Filmmakers<br/>
              & Creators
            </h2>
          </div>

          {/* Links Columns */}
          <div className="md:col-span-9 grid grid-cols-2 sm:grid-cols-4 gap-8 text-sm font-medium">
            
            {/* Column 1 */}
            <div className="space-y-3">
              <h3 className="font-bold opacity-50 mb-4">Klint AI</h3>
              <a href="#" className="block hover:underline">About</a>
              <a href="#" className="block hover:underline">Contact</a>
              <a href="#" className="block hover:underline">Pricing</a>
              <a href="#" className="block hover:underline">Apps</a>
              <a href="#" className="block hover:underline">Community</a>
              <a href="#" className="block hover:underline">Enterprise</a>
              <a href="#" className="block hover:underline">Team</a>
              <a href="#" className="block hover:underline">Copilot</a>
              <a href="#" className="block hover:underline">Reference Extension</a>
              <a href="#" className="block hover:underline">Blog</a>
              <a href="#" className="block hover:underline">Ambassador Program</a>
              <a href="#" className="block hover:underline">Discord</a>
            </div>

            {/* Column 2 */}
            <div className="space-y-3">
              <h3 className="font-bold opacity-50 mb-4">Image</h3>
              <a href="#" className="block hover:underline">Create Image</a>
              <a href="#" className="block hover:underline">Soul ID Character</a>
              <a href="#" className="block hover:underline">Draw to Edit</a>
              <a href="#" className="block hover:underline">Fashion Factory</a>
              <a href="#" className="block hover:underline">Edit Image</a>
              <a href="#" className="block hover:underline">Image Upscale</a>
              <a href="#" className="block hover:underline">Photodump Studio</a>
              <a href="#" className="block hover:underline">Klint Popcorn</a>
              <a href="#" className="block hover:underline">Nano Banana Pro</a>
              <a href="#" className="block hover:underline">Prompt Guide</a>
              <a href="#" className="block hover:underline">Flux 2</a>
            </div>

            {/* Column 3 */}
            <div className="space-y-3">
              <h3 className="font-bold opacity-50 mb-4">Video</h3>
              <a href="#" className="block hover:underline">Sora 2 Introduction</a>
              <a href="#" className="block hover:underline">Sora 2 AI Video Presets</a>
              <a href="#" className="block hover:underline">Veo 3.1 Introduction</a>
              <a href="#" className="block hover:underline">Shorts Generator</a>
              <a href="#" className="block hover:underline">YouTube Generator</a>
              <a href="#" className="block hover:underline">Reels Generator</a>
              <a href="#" className="block hover:underline">TikTok Generator</a>
              <a href="#" className="block hover:underline">Create Video</a>
              <a href="#" className="block hover:underline">Lipsync Studio</a>
              <a href="#" className="block hover:underline">Talking Avatar</a>
              <a href="#" className="block hover:underline">Draw to Video</a>
              <a href="#" className="block hover:underline">UGC Factory</a>
              <a href="#" className="block hover:underline">Video Upscale</a>
              <a href="#" className="block hover:underline">Kling 01</a>
              <a href="#" className="block hover:underline">Kling 2.6</a>
            </div>

             {/* Column 4 */}
             <div className="space-y-3">
              <h3 className="font-bold opacity-50 mb-4">Edit</h3>
              <a href="#" className="block hover:underline">Banana Placement</a>
              <a href="#" className="block hover:underline">Product Placement</a>
              <a href="#" className="block hover:underline">Edit Image</a>
              <a href="#" className="block hover:underline">Multi Reference</a>
              <a href="#" className="block hover:underline">Upscale</a>
              <a href="#" className="block hover:underline">Sora 2 Upscale</a>
            </div>

          </div>
        </div>

        {/* Bottom Bar */}
        <div className="max-w-[1400px] mx-auto mt-24 pt-8 border-t border-black/10 dark:border-white/10 flex flex-col md:flex-row justify-between items-center text-[10px] uppercase font-medium tracking-wider">
          <div className="mb-4 md:mb-0">
            535 Mission St, 14th floor, San Francisco, CA, 94105
          </div>
          <div className="flex gap-6">
            <a href="#" className="hover:underline">X / Twitter</a>
            <a href="#" className="hover:underline">Youtube</a>
            <a href="#" className="hover:underline">Instagram</a>
            <a href="#" className="hover:underline">Linkedin</a>
            <a href="#" className="hover:underline">Tiktok</a>
          </div>
        </div>
      </div>
      
      {/* Copyright Bar */}
      <div className="bg-black text-neutral-500 py-4 px-8 text-[10px] flex justify-between items-center border-t border-white/10">
        <span>© 2025 Klint AI™. All rights reserved.</span>
        <div className="flex gap-4">
            <a href="#" className="hover:text-white">Creative Challenge</a>
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Terms</a>
            <a href="#" className="hover:text-white">Cookie Notice</a>
        </div>
      </div>
    </footer>
  );
};
