import React from 'react';
import { 
  Shirt, 
  Scissors, 
  ShoppingBag, 
  Package, 
  BedDouble, 
  Utensils, 
  Sparkles, 
  Tag,
  GraduationCap,
  Baby,
  Waves,
  Footprints,
  Scroll,
  Shield,
  Briefcase,
  Gem,
  Umbrella,
  Layers,
  Droplets,
  Watch,
  Glasses,
  Crown,
  Heart,
  Wallet,
  CircleDot
} from 'lucide-react';

/**
 * @param {{ product?: any, name?: string, category?: string, family?: string, className?: string }} props
 */
export default function ProductIcon({ product, name, category, family, className }) {
    // Normalize inputs
    const pName = (product?.name || name || "").toLowerCase();
    const pFamily = (product?.family || family || "").toLowerCase();
    const pCategory = (product?.category || category || "").toLowerCase();

    const iconProps = { className: className || "w-5 h-5" };

    // Accessories & Small Items
    if (pName.includes('boné') || pName.includes('chapéu') || pName.includes('gorro')) return <Crown {...iconProps} />;
    if (pName.includes('luva')) return <CircleDot {...iconProps} />;
    if (pName.includes('bolsa') || pName.includes('mochila') || pName.includes('carteira')) return <ShoppingBag {...iconProps} />;
    if (pName.includes('cinto') || pName.includes('gravata') || pName.includes('lenço') || pName.includes('echarpe')) return <Wallet {...iconProps} />;
    if (pName.includes('óculos')) return <Glasses {...iconProps} />;
    
    // Ceremonial & Special
    if (pName.includes('beca') || pName.includes('toga')) return <GraduationCap {...iconProps} />;
    if (pName.includes('noiva') || pName.includes('casamento')) return <Heart {...iconProps} />;
    
    // Children
    if (pName.includes('pelúcia') || pName.includes('infantil') || pName.includes('bebe') || pName.includes('bebê') || pName.includes('bichinho')) return <Baby {...iconProps} />;
    
    // Swimwear
    if (pName.includes('biquíni') || pName.includes('biquini') || pName.includes('sunga') || pName.includes('maiô') || pName.includes('maio') || pName.includes('praia')) return <Waves {...iconProps} />;
    
    // Footwear
    if (pName.includes('tênis') || pName.includes('tenis') || pName.includes('sapato') || pName.includes('bota') || pName.includes('calçado') || pName.includes('sandália') || pName.includes('sandalia')) return <Footprints {...iconProps} />;
    
    // Outerwear & Heavy
    if (pName.includes('couro') || pName.includes('jaqueta') || pName.includes('casaco') || pName.includes('sobretudo') || pName.includes('parka')) return <Shield {...iconProps} />;
    if (pName.includes('impermeável') || pName.includes('impermeavel') || pName.includes('capa de chuva')) return <Umbrella {...iconProps} />;
    
    // Business / Formal
    if (pName.includes('terno') || pName.includes('blazer') || pName.includes('paletó') || pName.includes('paleto') || pName.includes('social')) return <Briefcase {...iconProps} />;
    
    // Dresses / Skirts / Elegant
    if (pName.includes('vestido') || pName.includes('saia') || pName.includes('festa') || pName.includes('gala') || pName.includes('longo')) return <Gem {...iconProps} />;

    // Pants & Shorts
    if (pName.includes('bermuda') || pName.includes('shorts') || pName.includes('short')) return <Layers {...iconProps} />;
    if (pName.includes('calça') || pName.includes('calca') || pName.includes('jeans') || pName.includes('legging')) return <Layers {...iconProps} />;

    // Household Textiles
    if (pName.includes('tapete') || pName.includes('cortina') || pName.includes('persiana') || pName.includes('almofada')) return <Scroll {...iconProps} />;
    if (pName.includes('toalha') || pName.includes('roupão') || pName.includes('roupao')) return <Droplets {...iconProps} />;
    if (pName.includes('edredom') || pName.includes('edredon') || pName.includes('cobertor') || pName.includes('manta') || pName.includes('colcha') || pName.includes('lençol') || pName.includes('lencol')) return <BedDouble {...iconProps} />;

    // Table Linens
    if (pName.includes('jogo americano') || pName.includes('guardanapo') || pName.includes('toalha de mesa')) return <Utensils {...iconProps} />;

    // Categories
    if (pCategory === 'costura') return <Scissors {...iconProps} />;
    if (pCategory === 'bags' || pName.includes('bag')) return <ShoppingBag {...iconProps} />;

    // Families
    if (pFamily === 'planos' || pCategory === 'planos' || pCategory === 'pacotes') return <Package {...iconProps} />;
    if (pFamily.includes('cama')) return <BedDouble {...iconProps} />;
    if (pFamily.includes('mesa')) return <Utensils {...iconProps} />;
    if (pFamily.includes('banho') || pCategory === 'limpeza') return <Sparkles {...iconProps} />;
    if (pCategory === 'especial') return <Tag {...iconProps} />;

    // Default
    return <Shirt {...iconProps} />;
}