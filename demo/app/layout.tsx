import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Tipper Tickets · Pruébalo en Sepolia', description: 'Crea, emite y canjea cupones reales. Explora los referrals paso a paso, sin wallet y con gas de prueba patrocinado.', icons: { icon: '/favicon.svg' } };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="es"><body>{children}</body></html>; }
