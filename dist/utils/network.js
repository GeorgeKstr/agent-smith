import os from "node:os";
export function getLanAddresses(port) {
    const results = [];
    const interfaces = os.networkInterfaces();
    for (const [, addrs] of Object.entries(interfaces)) {
        if (!addrs)
            continue;
        for (const addr of addrs) {
            if (addr.family === "IPv4" && !addr.internal) {
                // Skip obvious virtual/docker interfaces
                const name = addr.address;
                if (name.startsWith("172.") || name.startsWith("docker") || name.startsWith("br-") || name.startsWith("veth"))
                    continue;
                results.push(`http://${name}:${port}`);
            }
        }
    }
    return results;
}
export function formatLanUrls(port, host, extra) {
    const local = `http://127.0.0.1:${port}${extra ?? ""}`;
    const lan = getLanAddresses(port).map((u) => `${u}${extra ?? ""}`);
    const warnings = [];
    if (host === "0.0.0.0" || host === "::") {
        warnings.push("WARNING: This server is reachable from your LAN without a token.");
    }
    return { local, lan, warnings };
}
