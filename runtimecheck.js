/* Temporary headless-browser smoke check: console errors + basic interaction. Delete after use. */
const http = require("http")
const WebSocket = require("ws")

function getJSON(path) {
    return new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port: 9333, path }, res => {
            let data = ""
            res.on("data", chunk => data += chunk)
            res.on("end", () => {
                try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
            })
        }).on("error", reject)
    })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
    let targets
    for (let i = 0; i < 40; i++) {
        try {
            targets = await getJSON("/json")
            if (targets.some(t => t.type === "page")) break
        } catch {}
        await sleep(500)
    }
    const page = targets.find(t => t.type === "page")
    if (!page) throw new Error("No Chrome page target")

    const ws = new WebSocket(page.webSocketDebuggerUrl)
    let nextId = 0
    const pending = new Map()
    const problems = []

    ws.on("message", raw => {
        const msg = JSON.parse(raw)
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg)
            pending.delete(msg.id)
            return
        }
        if (msg.method === "Runtime.exceptionThrown") {
            const details = msg.params.exceptionDetails
            problems.push(`EXCEPTION: ${details.text} ${details.exception?.description ?? ""}`)
        }
        if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
            const text = msg.params.args.map(a => a.value ?? a.description ?? a.type).join(" ")
            if (!text.includes("Download the React DevTools")) problems.push(`CONSOLE ${msg.params.type}: ${text}`)
        }
        if (msg.method === "Log.entryAdded" && ["error", "warning"].includes(msg.params.entry.level)) {
            const text = msg.params.entry.text
            if (!/favicon/i.test(text)) problems.push(`LOG ${msg.params.entry.level}: ${text}`)
        }
    })

    const send = (method, params = {}) => new Promise(resolve => {
        const id = ++nextId
        pending.set(id, resolve)
        ws.send(JSON.stringify({ id, method, params }))
    })

    const evaluate = async expression => {
        const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
        if (res.result?.exceptionDetails) problems.push(`EVAL: ${res.result.exceptionDetails.text}`)
        return res.result?.result?.value
    }

    await new Promise(resolve => ws.on("open", resolve))
    await send("Runtime.enable")
    await send("Log.enable")
    await send("Page.enable")
    await send("Page.navigate", { url: "http://localhost:8080" })
    await sleep(9000)

    const boot = await evaluate(`JSON.stringify({
        canvases: document.querySelectorAll("canvas").length,
        inspector: document.body.innerText.includes("Processor Inspector"),
        branding: document.body.innerText.includes("RISC-V Studio"),
        buttons: [...document.querySelectorAll("button")].map(b => b.title).filter(Boolean)
    })`)
    console.log("BOOT", boot)

    // Load the Bubble Sort example through the real dropdown + change event
    await evaluate(`(() => {
        const select = document.querySelector("header select");
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(select, "Bubble Sort");
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return select.value;
    })()`)
    await sleep(2500)

    const loaded = await evaluate(`JSON.stringify({
        hasCode: document.body.innerText.includes("bubble") || document.body.innerText.includes("Bubble Sort"),
        lines: (document.body.innerText.match(/lines/g) || []).length,
        cycles: (document.body.innerText.match(/cycle/gi) || []).length
    })`)
    console.log("LOADED", loaded)

    const stepInfo = await evaluate(`(() => {
        const step = document.querySelector('button[title="Step one instruction"]');
        if (!step) return "no step button";
        step.click(); step.click(); step.click();
        return "clicked";
    })()`)
    await sleep(1500)

    const running = await evaluate(`(() => {
        const text = document.body.innerText;
        const index = text.indexOf("cycle");
        return JSON.stringify({
            step: ${JSON.stringify(stepInfo)},
            cycleText: index >= 0 ? text.slice(index, index + 40).replace(/\\n/g, " | ") : null,
            instructionPanel: text.includes("Instruction"),
            controlPanel: text.includes("Control"),
            componentTab: text.includes("Component")
        });
    })()`)
    console.log("RUNNING", running)

    console.log("PROBLEMS", problems.length ? JSON.stringify(problems, null, 2) : "none")
    ws.close()
    process.exit(0)
})().catch(err => {
    console.error("CHECK FAILED", err)
    process.exit(1)
})
