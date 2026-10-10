/**
 * Helper to provide SVG product visual representations matching the exact items in the reference image.
 */

export function getProductImageSvg(id: string): string {
  switch (id) {
    case "p1":
    case "shirt":
      // Men's Premium Shirt - Dark Green Long Sleeve Shirt
      return `data:image/svg+xml;utf8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%">
          <rect width="300" height="300" fill="#F3F4F6"/>
          <!-- Shirt Body -->
          <path d="M75 90 L115 65 L150 85 L185 65 L225 90 L205 130 L190 120 L190 260 L110 260 L110 120 L95 130 Z" fill="#0F382C"/>
          <!-- Collar & Buttons -->
          <path d="M115 65 L150 100 L185 65 L165 65 L150 80 L135 65 Z" fill="#1C5240"/>
          <path d="M150 80 L150 260" stroke="#0A261E" stroke-width="3" stroke-dasharray="4,8"/>
          <circle cx="150" cy="110" r="3" fill="#D1D5DB"/>
          <circle cx="150" cy="140" r="3" fill="#D1D5DB"/>
          <circle cx="150" cy="170" r="3" fill="#D1D5DB"/>
          <circle cx="150" cy="200" r="3" fill="#D1D5DB"/>
          <!-- Pocket -->
          <rect x="120" y="125" width="22" height="28" rx="2" fill="#164636" stroke="#0F382C" stroke-width="2"/>
          <!-- Sleeves -->
          <path d="M75 90 L45 180 L75 190 L98 125 Z" fill="#0D3126"/>
          <path d="M225 90 L255 180 L225 190 L202 125 Z" fill="#0D3126"/>
        </svg>
      `)}`;

    case "p2":
    case "kurti":
      // Women's Kurti - Pink floral kurti
      return `data:image/svg+xml;utf8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%">
          <rect width="300" height="300" fill="#FDF2F8"/>
          <!-- Kurti Body -->
          <path d="M100 70 L135 60 L150 75 L165 60 L200 70 L215 260 L85 260 Z" fill="#EC4899"/>
          <!-- Neckline & embroidery pattern -->
          <path d="M135 60 L150 110 L165 60 Z" fill="#F472B6"/>
          <path d="M150 75 L150 160" stroke="#FFF" stroke-width="2"/>
          <circle cx="150" cy="120" r="4" fill="#FDE047"/>
          <circle cx="150" cy="140" r="4" fill="#FDE047"/>
          <!-- Floral patterns -->
          <circle cx="115" cy="180" r="6" fill="#FDE047" opacity="0.8"/>
          <circle cx="185" cy="180" r="6" fill="#FDE047" opacity="0.8"/>
          <circle cx="130" cy="220" r="8" fill="#FDE047" opacity="0.8"/>
          <circle cx="170" cy="220" r="8" fill="#FDE047" opacity="0.8"/>
          <!-- 3/4 Sleeves -->
          <path d="M100 70 L65 140 L90 150 L108 110 Z" fill="#DB2777"/>
          <path d="M200 70 L235 140 L210 150 L192 110 Z" fill="#DB2777"/>
        </svg>
      `)}`;

    case "p3":
    case "jhumka":
      // Gold Jhumka - Traditional 22k Indian Gold Jhumka Earrings
      return `data:image/svg+xml;utf8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%">
          <rect width="300" height="300" fill="#FFFBEB"/>
          <!-- Ear Stud -->
          <circle cx="150" cy="70" r="22" fill="#EAB308" stroke="#CA8A04" stroke-width="4"/>
          <circle cx="150" cy="70" r="12" fill="#FACC15"/>
          <circle cx="150" cy="70" r="4" fill="#B45309"/>
          <!-- Connecting Ring -->
          <ellipse cx="150" cy="102" rx="4" ry="10" fill="#CA8A04"/>
          <!-- Jhumka Dome -->
          <path d="M100 150 Q150 110 200 150 L205 175 C205 185, 95 185, 95 175 Z" fill="#EAB308" stroke="#CA8A04" stroke-width="3"/>
          <path d="M110 160 Q150 135 190 160" fill="none" stroke="#FDE047" stroke-width="3"/>
          <!-- Hanging Little Gold Beads (Ghungroo) -->
          <circle cx="105" cy="195" r="5" fill="#EAB308"/>
          <circle cx="120" cy="198" r="5" fill="#FACC15"/>
          <circle cx="135" cy="200" r="5" fill="#EAB308"/>
          <circle cx="150" cy="202" r="6" fill="#FDE047"/>
          <circle cx="165" cy="200" r="5" fill="#EAB308"/>
          <circle cx="180" cy="198" r="5" fill="#FACC15"/>
          <circle cx="195" cy="195" r="5" fill="#EAB308"/>
        </svg>
      `)}`;

    case "p4":
    case "bracelet":
      // Imitation Bracelet - Gold Floral Bracelet
      return `data:image/svg+xml;utf8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%">
          <rect width="300" height="300" fill="#F8FAFC"/>
          <!-- Bracelet Oval Loop -->
          <ellipse cx="150" cy="150" rx="95" ry="55" fill="none" stroke="#EAB308" stroke-width="8" stroke-dasharray="14,4"/>
          <!-- Center Floral Motif -->
          <circle cx="150" cy="95" r="16" fill="#FACC15" stroke="#CA8A04" stroke-width="3"/>
          <circle cx="150" cy="95" r="6" fill="#DC2626"/>
          <!-- Accent Gems -->
          <circle cx="110" cy="105" r="10" fill="#EAB308"/>
          <circle cx="190" cy="105" r="10" fill="#EAB308"/>
          <circle cx="80" cy="130" r="8" fill="#FACC15"/>
          <circle cx="220" cy="130" r="8" fill="#FACC15"/>
        </svg>
      `)}`;

    case "p5":
    case "jeans":
      // Denim Jeans - Blue Denim Jeans
      return `data:image/svg+xml;utf8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%">
          <rect width="300" height="300" fill="#F3F4F6"/>
          <!-- Folded Jeans Body -->
          <path d="M85 70 L215 70 L210 240 L155 240 L150 130 L145 240 L90 240 Z" fill="#1E40AF"/>
          <!-- Waistband & Belt Loops -->
          <rect x="85" y="70" width="130" height="22" fill="#1D4ED8"/>
          <rect x="105" y="68" width="8" height="26" fill="#1E3A8A"/>
          <rect x="146" y="68" width="8" height="26" fill="#1E3A8A"/>
          <rect x="187" y="68" width="8" height="26" fill="#1E3A8A"/>
          <!-- Yellow Stitching Lines -->
          <path d="M90 92 L210 92" stroke="#EAB308" stroke-width="2" stroke-dasharray="4,4"/>
          <path d="M150 92 L150 130" stroke="#EAB308" stroke-width="2"/>
          <path d="M100 115 C100 135, 130 135, 135 115" stroke="#EAB308" stroke-width="2" fill="none"/>
          <path d="M200 115 C200 135, 170 135, 165 115" stroke="#EAB308" stroke-width="2" fill="none"/>
          <!-- Metal Button -->
          <circle cx="150" cy="81" r="5" fill="#D1D5DB" stroke="#4B5563" stroke-width="2"/>
        </svg>
      `)}`;

    case "p6":
    case "handbag":
      // Ladies Handbag - Tan Brown Leather Handbag
      return `data:image/svg+xml;utf8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%">
          <rect width="300" height="300" fill="#FAF5FF"/>
          <!-- Handles -->
          <path d="M110 130 C110 50, 190 50, 190 130" fill="none" stroke="#78350F" stroke-width="10" stroke-linecap="round"/>
          <!-- Bag Body -->
          <path d="M75 130 L225 130 L240 250 C240 260, 230 265, 220 265 L80 265 C70 265, 60 260, 60 250 Z" fill="#B45309"/>
          <!-- Front Flap / Accent -->
          <path d="M75 130 L225 130 L210 185 L90 185 Z" fill="#92400E"/>
          <!-- Gold Buckle & Hardware -->
          <rect x="135" y="170" width="30" height="24" rx="4" fill="#EAB308" stroke="#CA8A04" stroke-width="3"/>
          <rect x="143" y="176" width="14" height="12" rx="2" fill="#78350F"/>
        </svg>
      `)}`;

    case "p7":
    case "chain":
      // Gold Chain - 22k Gold Chain Necklace
      return `data:image/svg+xml;utf8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%">
          <rect width="300" height="300" fill="#FFFBEB"/>
          <!-- Chain Loop -->
          <path d="M70 70 Q150 250 230 70" fill="none" stroke="#EAB308" stroke-width="8" stroke-dasharray="10,5"/>
          <path d="M85 70 Q150 230 215 70" fill="none" stroke="#FACC15" stroke-width="4"/>
          <!-- Gold Pendant -->
          <circle cx="150" cy="175" r="18" fill="#EAB308" stroke="#CA8A04" stroke-width="3"/>
          <circle cx="150" cy="175" r="10" fill="#FEF08A"/>
          <circle cx="150" cy="175" r="4" fill="#B45309"/>
        </svg>
      `)}`;

    case "p8":
    case "earrings":
    default:
      // Fashion Earrings - Gold and Crystal Earrings
      return `data:image/svg+xml;utf8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%">
          <rect width="300" height="300" fill="#F8FAFC"/>
          <!-- Top Crystal Stud -->
          <polygon points="150,55 165,70 150,85 135,70" fill="#38BDF8" stroke="#0284C7" stroke-width="2"/>
          <!-- Connecting Link -->
          <line x1="150" y1="85" x2="150" y2="115" stroke="#EAB308" stroke-width="4"/>
          <!-- Main Tear Drop Crystal -->
          <path d="M150 115 C120 180, 120 220, 150 230 C180 220, 180 180, 150 115 Z" fill="#E0F2FE" stroke="#38BDF8" stroke-width="3"/>
          <path d="M150 135 C135 180, 138 205, 150 215" fill="none" stroke="#BAE6FD" stroke-width="3"/>
          <!-- Gold Trim -->
          <circle cx="150" cy="230" r="6" fill="#EAB308"/>
        </svg>
      `)}`;
  }
}
