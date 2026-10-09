/** @type {import('next').NextConfig} */
const nextConfig = {
  // exceljs (Moneta export uploads) is Node-only; load it at runtime instead of bundling.
  experimental: { serverComponentsExternalPackages: ['exceljs'] },
}
module.exports = nextConfig
