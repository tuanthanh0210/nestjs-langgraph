import { existsSync, readFileSync } from 'node:fs';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { normalizeText, resolveDataPath, tokenize, truncate } from '../catalog/catalog.utils.js';

export interface StoreInfoSection {
  title: string;
  content: string;
}

export interface StoreInfoSearchResult {
  query: string;
  sections: StoreInfoSection[];
  message?: string;
}

@Injectable()
export class StoreInfoService implements OnModuleInit {
  private readonly logger = new Logger(StoreInfoService.name);
  private sections: StoreInfoSection[] = [];

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const filePath = resolveDataPath(this.config.get('STORE_INFO_FILE', { infer: true }));

    if (!existsSync(filePath)) {
      this.logger.warn(
        `Store info file not found at ${filePath}. Policy questions will have no source.`,
      );
      return;
    }

    const content = readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').trim();
    this.sections = this.parse(content);
    this.logger.log(`Loaded ${this.sections.length} store-info sections from ${filePath}`);
  }

  search(query: string, limit = 3): StoreInfoSearchResult {
    const tokens = tokenize(query);

    if (this.sections.length === 0) {
      return {
        query,
        sections: [],
        message:
          'No store information is configured. Ask the customer to contact the store directly.',
      };
    }

    if (tokens.length === 0) {
      return {
        query,
        sections: this.sections.slice(0, limit).map((section) => ({
          title: section.title,
          content: truncate(section.content, 1200),
        })),
      };
    }

    const scored = this.sections
      .map((section) => {
        const title = normalizeText(section.title);
        const body = normalizeText(section.content);
        let score = 0;
        for (const token of tokens) {
          if (title.includes(token)) score += 5;
          if (body.includes(token)) score += 1;
        }
        return { section, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(Math.max(limit, 1), 5));

    if (scored.length === 0) {
      return {
        query,
        sections: [],
        message:
          'No policy section matched. Answer only from known information and offer to connect the customer with a human.',
      };
    }

    return {
      query,
      sections: scored.map(({ section }) => ({
        title: section.title,
        content: truncate(section.content, 1200),
      })),
    };
  }

  private parse(content: string): StoreInfoSection[] {
    const parts = content.split(/^##\s+/m);
    const sections: StoreInfoSection[] = [];
    const intro = parts.shift()?.trim();

    if (intro) {
      const cleaned = intro.replace(/^#\s+.*\n?/, '').trim();
      if (cleaned) {
        const firstLine = intro.split('\n')[0].replace(/^#\s+/, '').trim();
        sections.push({ title: firstLine || 'Giới thiệu', content: cleaned });
      }
    }

    for (const part of parts) {
      const [titleLine, ...rest] = part.split('\n');
      const title = titleLine.trim();
      const body = rest.join('\n').trim();
      if (title) sections.push({ title, content: body });
    }

    return sections;
  }
}
