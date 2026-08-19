import { Injectable } from '@nestjs/common';
import type { LinkPreview } from '@betweenus/shared-types';

interface CachedPreview {
  preview: LinkPreview | null;
  expiresAt: number;
}

@Injectable()
export class UnfurlService {
  private readonly cache = new Map<string, CachedPreview>();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  async unfurl(rawUrl: string): Promise<LinkPreview | null> {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();

    // Check in-memory cache
    const cached = this.cache.get(trimmed);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        return cached.preview;
      }
      this.cache.delete(trimmed);
    }

    const preview = await this.fetchPreview(trimmed);

    // Evict old entries if cache is growing too large
    if (this.cache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of this.cache) {
        if (value.expiresAt <= now) this.cache.delete(key);
      }
    }

    this.cache.set(trimmed, {
      preview,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    return preview;
  }

  private async fetchPreview(targetUrl: string): Promise<LinkPreview | null> {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return null;
    }

    // SSRF & Protocol validation
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    if (this.isPrivateHost(parsed.hostname)) {
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(parsed.href, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'BetweenUs-Bot/1.0 (+https://betweenus.app; Link Preview)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        return null;
      }

      // Read max 128 KB of HTML to prevent memory hogging on massive pages
      const reader = response.body?.getReader();
      if (!reader) return null;

      let html = '';
      let bytesRead = 0;
      const MAX_BYTES = 128 * 1024;

      while (bytesRead < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          bytesRead += value.length;
          html += new TextDecoder('utf-8').decode(value, { stream: true });
        }
      }
      reader.cancel().catch(() => {});

      return this.parseHtml(html, parsed);
    } catch {
      return null;
    }
  }

  private parseHtml(html: string, baseUrl: URL): LinkPreview {
    const ogTitle = this.extractMeta(html, 'og:title') || this.extractMeta(html, 'twitter:title') || this.extractTitle(html);
    const ogDescription = this.extractMeta(html, 'og:description') || this.extractMeta(html, 'twitter:description') || this.extractMeta(html, 'description');
    const rawImage = this.extractMeta(html, 'og:image') || this.extractMeta(html, 'twitter:image') || this.extractMeta(html, 'og:image:url');
    const ogSiteName = this.extractMeta(html, 'og:site_name') || baseUrl.hostname;
    const rawFavicon = this.extractFavicon(html);

    const image = rawImage ? this.resolveUrl(rawImage, baseUrl) : null;
    const favicon = rawFavicon ? this.resolveUrl(rawFavicon, baseUrl) : this.resolveUrl('/favicon.ico', baseUrl);

    return {
      url: baseUrl.href,
      title: ogTitle || null,
      description: ogDescription ? ogDescription.slice(0, 300) : null,
      image,
      siteName: ogSiteName || baseUrl.hostname,
      favicon,
    };
  }

  private extractMeta(html: string, property: string): string | null {
    const escaped = property.replace(':', '\\:');
    const pattern1 = new RegExp(`<meta[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["']`, 'i');
    const match1 = html.match(pattern1);
    if (match1?.[1]) return this.decodeEntities(match1[1].trim());

    const pattern2 = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i');
    const match2 = html.match(pattern2);
    if (match2?.[1]) return this.decodeEntities(match2[1].trim());

    return null;
  }

  private extractTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1] ? this.decodeEntities(match[1].trim()) : null;
  }

  private extractFavicon(html: string): string | null {
    const match1 = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i);
    if (match1?.[1]) return match1[1].trim();

    const match2 = html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
    if (match2?.[1]) return match2[1].trim();

    return null;
  }

  private resolveUrl(relativeOrAbsolute: string, baseUrl: URL): string | null {
    try {
      return new URL(relativeOrAbsolute, baseUrl).href;
    } catch {
      return null;
    }
  }

  private decodeEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  }

  private isPrivateHost(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    if (
      lower === 'localhost' ||
      lower.endsWith('.localhost') ||
      lower.endsWith('.local') ||
      lower.endsWith('.internal') ||
      lower === '127.0.0.1' ||
      lower === '0.0.0.0' ||
      lower === '::1' ||
      lower === '169.254.169.254'
    ) {
      return true;
    }

    const ipParts = lower.split('.').map(Number);
    if (ipParts.length === 4 && ipParts.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
      const p0 = ipParts[0] ?? -1;
      const p1 = ipParts[1] ?? -1;
      if (p0 === 10) return true;
      if (p0 === 127) return true;
      if (p0 === 192 && p1 === 168) return true;
      if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
      if (p0 === 169 && p1 === 254) return true;
    }
    return false;
  }
}
