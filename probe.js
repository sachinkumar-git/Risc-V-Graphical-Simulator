/* Temporary headless-browser DOM probe. Delete after use. */
const http = require("http")
const WebSocket = require("ws")
const sleep = ms => new Promise(r => setTimeout(r, ms))

function getJSON(path) {
    return new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port: 9333, path }, res => {
            let data = ""
            res.on("data", c => data += c)
            res.on("end", () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
        }).on("error", reject)
    })
}

;(async () => {
    const page = (await getJSON("/json")).find(t => t.type === "page")
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    let id = 0
    const pending = new Map()
    ws.on("message", raw => {
        const msg = JSON.parse(raw)
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    })
    const send = (method, params = {}) => new Promise(resolve => {
        const n = ++id
        pending.set(n, resolve)
        ws.send(JSON.stringify({ id: n, method, params }))
    })
    const evaluate = async expression => {
        const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
        return res.result?.result?.value
    }
    await new Promise(r => ws.on("open", r))
    await send("Runtime.enable")

    console.log("SCENE", await evaluate(`(() => {
        const c = document.querySelector("canvas");
        const gl = c && (c.getContext("webgl2") || c.getContext("webgl"));
        return JSON.stringify({
            canvas: c ? { w: c.width, h: c.height, webgl: !!gl } : null,
            currentLineMarks: document.querySelectorAll(".cm-sim-current-line").length,
            errorLineMarks: document.querySelectorAll(".cm-sim-error-line").length,
            registerRows: document.querySelectorAll("aside table tr").length,
            hasA0Row: document.body.innerText.includes("a0 (x10)")
        });
    })()`))

    // Open the Control tab
    await evaluate(`[...document.querySelectorAll("aside button")].find(b => b.textContent === "Control").click()`)
    await sleep(400)
    console.log("CONTROL", await evaluate(`JSON.stringify({
        regWrite: document.body.innerText.includes("RegWrite"),
        aluControl: document.body.innerText.includes("ALU control"),
        takeBranch: document.body.innerText.includes("Take branch")
    })`))

    // Open the Instruction tab
    await evaluate(`[...document.querySelectorAll("aside button")].find(b => b.textContent === "Instruction").click()`)
    await sleep(400)
    console.log("INSTRUCTION", await evaluate(`JSON.stringify({
        fields: ["opcode", "funct3", "funct7", "PC", "Format"].filter(t => document.body.innerText.includes(t)),
        hasMachineCode: /0x[0-9A-F]{8}/.test(document.body.innerText)
    })`))

    // Open the Component tab (no selection yet)
    await evaluate(`[...document.querySelectorAll("aside button")].find(b => b.textContent === "Component").click()`)
    await sleep(300)
    console.log("COMPONENT", await evaluate(`JSON.stringify({
        idleHint: document.body.innerText.includes("Select a component in the 3D processor")
    })`))

    console.log("CONSOLE_ERRORS", await evaluate(`document.querySelectorAll("canvas").length`))
    ws.close()
    process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
