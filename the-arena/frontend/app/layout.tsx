import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'The Arena — AI Debate Show by Lenny',
  description: 'Watch the greatest minds in product and startups debate the hottest topics — powered by their actual words from Lenny\'s Podcast.',
  openGraph: {
    title: 'The Arena — AI Debate Show by Lenny',
    description: 'AI-powered debates grounded in real interviews from Lenny\'s Podcast',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-arena-bg text-arena-text antialiased">
        {children}
      </body>
    </html>
  )
}
