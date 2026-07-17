import React, { useState, useEffect } from "react";

const ARIANG_URL = "https://ariang.mayswind.net/latest/";
const ARIANG_PROTOCOL = "ws";
const ARIANG_HOST = "localhost";
const ARIANG_PORT = "6800";
const ARIANG_INTERFACE = "jsonrpc";
const ARIANG_FULL_URL = `${ARIANG_URL}#!/settings/rpc/set/${ARIANG_PROTOCOL}/${ARIANG_HOST}/${ARIANG_PORT}/${ARIANG_INTERFACE}/`;

export default function App() {
    const [enabled, setEnabled] = useState<boolean>(true);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ active: 0, waiting: 0, stopped: 0 });

    useEffect(() => {
        // Load initial state
        browser.runtime.sendMessage({ type: "get-enabled" }).then((resp) => {
            if (resp?.enabled !== undefined) setEnabled(resp.enabled);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    const handleToggle = () => {
        const next = !enabled;
        setEnabled(next);
        browser.runtime.sendMessage({ type: "set-enabled", enabled: next });
    };

    const handleOpenAriaNg = () => {
        browser.tabs.create({ url: ARIANG_FULL_URL });
    };

    return (
        <>
            <div className="header">
                <span className="title">Aria2 Shim</span>
                <span>
                    <span className={`status-dot ${enabled ? "on" : "off"}`} />
                    {enabled ? "Active" : "Disabled"}
                </span>
            </div>

            <div className="toggle-row">
                <div className="toggle-label">
                    {enabled ? "Service Running" : "Service Stopped"}
                </div>
                <button
                    className={`toggle ${enabled ? "on" : ""}`}
                    onClick={handleToggle}
                    disabled={loading}
                    title={enabled ? "Click to disable" : "Click to enable"}
                />
            </div>

            <button className="btn btn-primary" onClick={handleOpenAriaNg}>
                Open AriaNg
            </button>

            <div className="divider" />

            <div className="stats">
                Managing downloads via AriaNg on localhost:6800
            </div>
        </>
    );
}
