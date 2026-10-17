import type { AdminAction, Proposal, Product, SocialDraft } from '@angibell/contracts';
export declare class ProposalService {
    createProposal(action: AdminAction, actorId: string): Proposal;
    confirmProposal(proposalId: string, actorId: string, confirmation: 'CONFIRM'): {
        proposal: Proposal;
        product: Product | null;
        socialDraft: SocialDraft | null;
    };
}
export declare const proposalService: ProposalService;
