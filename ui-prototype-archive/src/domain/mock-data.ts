import { getProductImageSvg } from "@/lib/product-images";

export interface ProductItem {
  id: string;
  name: string;
  category:
    "Clothing" | "Imitation Jewellery" | "Gold Jewellery" | "Silver Jewellery" | "Accessories";
  price: number;
  specs: string;
  stock: number;
  tag: string;
  sku: string;
  status: "Active" | "Low Stock" | "Out of Stock";
  image: string;
  featured?: boolean;
}

export interface CartItem {
  product: ProductItem;
  quantity: number;
  variant?: string;
}

export interface SaleRecord {
  id: string;
  invoiceNumber: string;
  dateTime: string;
  customerName: string;
  customerPhone?: string;
  itemsCount: number;
  totalAmount: number;
  paymentMethod: "Cash" | "UPI" | "Card" | "Split";
  status: "Completed" | "Draft" | "Returned";
}

export const INITIAL_PRODUCTS: ProductItem[] = [
  {
    id: "p1",
    name: "Men's Premium Shirt",
    category: "Clothing",
    price: 1299,
    specs: "M, L, XL • 12 in stock",
    stock: 12,
    tag: "NR-CL-001",
    sku: "NR-CL-001",
    status: "Active",
    image: getProductImageSvg("p1"),
    featured: true,
  },
  {
    id: "p2",
    name: "Women's Kurti",
    category: "Clothing",
    price: 899,
    specs: "M, L, XL • 8 in stock",
    stock: 8,
    tag: "NR-CL-002",
    sku: "NR-CL-002",
    status: "Active",
    image: getProductImageSvg("p2"),
    featured: true,
  },
  {
    id: "p3",
    name: "Gold Jhumka",
    category: "Gold Jewellery",
    price: 45000,
    specs: "22k • 5.2g • 3 in stock",
    stock: 3,
    tag: "NR-GJ-001",
    sku: "NR-GJ-001",
    status: "Active",
    image: getProductImageSvg("p3"),
    featured: true,
  },
  {
    id: "p4",
    name: "Imitation Bracelet",
    category: "Imitation Jewellery",
    price: 499,
    specs: "Tag: IJ-1023 • 15 in stock",
    stock: 15,
    tag: "NR-IJ-023",
    sku: "NR-IJ-023",
    status: "Active",
    image: getProductImageSvg("p4"),
    featured: false,
  },
  {
    id: "p5",
    name: "Denim Jeans",
    category: "Clothing",
    price: 1599,
    specs: "30, 32, 34 • 10 in stock",
    stock: 10,
    tag: "NR-CL-003",
    sku: "NR-CL-003",
    status: "Active",
    image: getProductImageSvg("p5"),
    featured: false,
  },
  {
    id: "p6",
    name: "Ladies Handbag",
    category: "Accessories",
    price: 1299,
    specs: "5 in stock",
    stock: 5,
    tag: "NR-AC-001",
    sku: "NR-AC-001",
    status: "Active",
    image: getProductImageSvg("p6"),
    featured: true,
  },
  {
    id: "p7",
    name: "Gold Chain",
    category: "Gold Jewellery",
    price: 68500,
    specs: "22k • 8.5g • 2 in stock",
    stock: 2,
    tag: "NR-GJ-002",
    sku: "NR-GJ-002",
    status: "Active",
    image: getProductImageSvg("p7"),
    featured: false,
  },
  {
    id: "p8",
    name: "Fashion Earrings",
    category: "Imitation Jewellery",
    price: 299,
    specs: "Tag: IJ-554 • 20 in stock",
    stock: 20,
    tag: "NR-IJ-024",
    sku: "NR-IJ-024",
    status: "Active",
    image: getProductImageSvg("p8"),
    featured: false,
  },
];

export const INITIAL_CART: CartItem[] = [
  {
    product: INITIAL_PRODUCTS[0]!, // Men's Premium Shirt
    quantity: 1,
    variant: "M, Green",
  },
  {
    product: INITIAL_PRODUCTS[2]!, // Gold Jhumka
    quantity: 1,
    variant: "22k • 5.2g",
  },
  {
    product: INITIAL_PRODUCTS[3]!, // Imitation Bracelet
    quantity: 2,
    variant: "Tag: IJ-1023",
  },
];

export const INITIAL_SALES: SaleRecord[] = [
  {
    id: "s1",
    invoiceNumber: "NR25-00123",
    dateTime: "10 Oct 2026 10:24 AM",
    customerName: "Walk-in",
    itemsCount: 3,
    totalAmount: 48715,
    paymentMethod: "Cash",
    status: "Completed",
  },
  {
    id: "s2",
    invoiceNumber: "NR25-00122",
    dateTime: "10 Oct 2026 09:45 AM",
    customerName: "Priya Reddy",
    itemsCount: 2,
    totalAmount: 3499,
    paymentMethod: "UPI",
    status: "Completed",
  },
  {
    id: "s3",
    invoiceNumber: "NR25-00121",
    dateTime: "09 Oct 2026 06:12 PM",
    customerName: "Walk-in",
    itemsCount: 1,
    totalAmount: 1299,
    paymentMethod: "Card",
    status: "Completed",
  },
  {
    id: "s4",
    invoiceNumber: "NR25-00120",
    dateTime: "09 Oct 2026 04:30 PM",
    customerName: "Ramesh",
    itemsCount: 4,
    totalAmount: 12499,
    paymentMethod: "Cash",
    status: "Completed",
  },
  {
    id: "s5",
    invoiceNumber: "NR25-00119",
    dateTime: "09 Oct 2026 02:15 PM",
    customerName: "Walk-in",
    itemsCount: 1,
    totalAmount: 1899,
    paymentMethod: "UPI",
    status: "Completed",
  },
];
