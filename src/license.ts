import nacl from "tweetnacl";

/** Ed25519 public key (hex) matching the private key kept offline by Strahm Digital. */
export const PUBLIC_KEY_HEX = "4064ebb98f0440c233dae402f23337c0119a4e0035c68dbdc3dcbd27c6f6759c";

export interface LicensePayload {
	p: string; // plugin id
	e: string; // sha-256 prefix of buyer email (never the email itself)
	s: string; // order reference
	i: string; // issued date YYYY-MM-DD
}

const b64u = {
	dec(s: string): Uint8Array {
		const t = s.replace(/-/g, "+").replace(/_/g, "/");
		const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
		return Uint8Array.from(bin, (c) => c.charCodeAt(0));
	},
};

function hex(h: string): Uint8Array {
	const out = new Uint8Array(h.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
	return out;
}

/** Key format: BR1.<payload b64url>.<signature b64url>. Verified fully offline. */
export function verifyLicense(key: string, pluginId: string, publicKeyHex: string = PUBLIC_KEY_HEX): LicensePayload | null {
	try {
		const parts = key.trim().split(".");
		if (parts.length !== 3 || parts[0] !== "BR1") return null;
		const payloadBytes = b64u.dec(parts[1]);
		const sig = b64u.dec(parts[2]);
		const msg = new TextEncoder().encode(`BR1.${parts[1]}`);
		if (!nacl.sign.detached.verify(msg, sig, hex(publicKeyHex))) return null;
		const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicensePayload;
		if (payload.p !== pluginId) return null;
		return payload;
	} catch {
		return null;
	}
}
