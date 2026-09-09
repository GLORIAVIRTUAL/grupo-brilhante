import React from 'react';
import { Instagram, Facebook } from 'lucide-react';

const INSTAGRAM_URL = 'https://www.instagram.com/grupo.brilhante/';
const FACEBOOK_URL = 'https://www.facebook.com/Brilhantehigienizacao/';

export default function SocialLinks({ variant = 'footer' }) {
  return (
    <div className={`social-links social-links--${variant}`}>
      <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Instagram do Grupo Brilhante">
        <Instagram size={20} />
      </a>
      <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" aria-label="Facebook do Grupo Brilhante">
        <Facebook size={20} />
      </a>
    </div>
  );
}