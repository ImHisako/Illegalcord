import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import { Button, React } from "@webpack/common";
import { DataStore } from "@api/index";
import { PLUGIN_VERSION, GITHUB_RELEASE_URL } from "../constants";

export const UpdateModal = ({ props, version, releaseNotes }: { props: ModalProps; version: string; releaseNotes: string; }) => {
    const cleanNotes = releaseNotes
        .replace(/#{1,6}\s/g, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        .substring(0, 500);

    return (
        <ModalRoot {...props}>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                    <div>
                        <div style={{ color: "var(--text-positive)", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Update Available</div>
                        <span style={{ color: "#fff", fontSize: "20px", fontWeight: 600 }}>Server Cloner</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>v{PLUGIN_VERSION}</span>
                        <span style={{ color: "var(--text-muted)" }}>→</span>
                        <span style={{ background: "var(--text-positive)", color: "white", padding: "4px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: 600 }}>v{version}</span>
                    </div>
                </div>
            </ModalHeader>
            <ModalContent>
                <div style={{ padding: "8px 0" }}>
                    <div style={{ background: "var(--background-secondary)", borderRadius: "12px", padding: "16px", maxHeight: "200px", overflowY: "auto" }}>
                        <div style={{ color: "var(--text-muted)", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>What's New</div>
                        <div style={{ fontSize: "13px", lineHeight: 1.6, color: "var(--text-normal)", whiteSpace: "pre-wrap" }}>{cleanNotes}</div>
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <Button color={Button.Colors.PRIMARY} onClick={async () => {
                        await DataStore.set('ServerCloner-dismissed-version', version);
                        props.onClose();
                    }}>
                        Later
                    </Button>
                    <Button color={Button.Colors.GREEN} onClick={async () => {
                        window.open(GITHUB_RELEASE_URL, '_blank');
                        await DataStore.set('ServerCloner-dismissed-version', version);
                        props.onClose();
                    }}>
                        Update Now
                    </Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
};

export function showUpdateModal(version: string, releaseNotes: string) {
    openModal((modalProps: ModalProps) => (
        <UpdateModal props={modalProps} version={version} releaseNotes={releaseNotes} />
    ));
}
