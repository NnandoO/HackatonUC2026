import type { SocialDraft, Page } from '@angibell/contracts';
export declare class SocialService {
    getSocialDrafts(options: {
        limit?: number;
        cursor?: string | null;
    }): Page<SocialDraft>;
}
export declare const socialService: SocialService;
