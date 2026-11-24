import React from "react"
import { Toaster } from "react-hot-toast"

import "bootstrap/dist/css/bootstrap.min.css"
import "css/site.css"
import "tippy.js/dist/tippy.css"
import SimulatorUI from "./SimulatorUI"

export default function App() {
    return (
        <React.StrictMode>
            <SimulatorUI />
            <Toaster
                position="top-center"
                toastOptions={{
                    duration: 8000,
                    style: {
                        width: "380px",
                        maxWidth: "90vw",
                        background: "var(--surface-3)",
                        color: "var(--text)",
                        border: "1px solid var(--border-strong)",
                        borderRadius: "var(--radius)",
                        fontSize: "13px",
                        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
                    },
                }}
            />
        </React.StrictMode>
    )
}
