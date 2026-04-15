export interface CloneOptions {
    cloneChannels: boolean;
    cloneRoles: boolean;
    cloneOnboarding: boolean;
    cloneSystemFlags: boolean;
    resumeMode: boolean;
    targetGuildId: string | null;
    cloneEmojis?: boolean;
}

export interface NotificationAction {
    label: string;
    onClick: (id: string) => void;
    type?: "default" | "danger";
    id?: string;
}
