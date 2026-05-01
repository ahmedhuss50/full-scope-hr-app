/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // Future: rewrites for subdomain-per-tenant (C5). For now we use /apply/[tenant] path routing.
}

export default nextConfig
