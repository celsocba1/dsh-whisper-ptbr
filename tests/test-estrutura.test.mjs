// Testes de regressão do dsh-whisper-ptbr — roda com `node --test` puro (sem dependências).
// Valida a estrutura do pacote: lock de assets (sha256 pinado), registro no patch,
// correções de termos e ausência de caminhos/segredos hardcoded.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"
import assert from "node:assert/strict"

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = join(RAIZ, "pkg", "dsh-speech-to-text-whisper")

describe("runtime/assets.json — pinos dos modelos", () => {
  const assets = JSON.parse(readFileSync(join(pkg, "runtime", "assets.json"), "utf8"))

  it("tem encoder, decoder e tokens do turbo pinados", () => {
    for (const [modelo, ativos] of Object.entries(assets.models ?? {})) {
      for (const [nome, ativo] of Object.entries(ativos)) {
        assert.match(ativo.name, /\.onnx$|\.txt$/, `${modelo}.${nome} deve ter arquivo`)
        assert.match(ativo.sha256, /^[0-9a-f]{64}$/, `${modelo}.${nome} deve ter sha256`)
        assert.ok(Number.isInteger(ativo.bytes) && ativo.bytes > 0, `${modelo}.${nome} deve ter bytes`)
      }
    }
    assert.ok(assets.models?.turbo?.encoder && assets.models?.turbo?.decoder, "turbo completo")
  })

  it("tem o VAD silero pinado", () => {
    assert.match(assets.vad?.sha256, /^[0-9a-f]{64}$/)
    assert.ok(assets.modelsOrigins === undefined || Array.isArray(assets.modelsOrigins),
      "campo de origens, quando existir, é lista")
    // as origens de download vivem no schema do Config (worker.js), não no lock
    const worker = readFileSync(join(pkg, "lib", "worker.js"), "utf8")
    assert.ok(worker.includes("huggingface.co"), "origem de download no provider")
  })
})

describe("registro no perfil (install.sh + cordis.patch.yml)", () => {
  const install = readFileSync(join(RAIZ, "install.sh"), "utf8")
  const cordis = readFileSync(join(pkg, "cordis.patch.yml"), "utf8")

  it("install.sh usa marcadores de bloco reutilizáveis", () => {
    const marcador = "# >>> dsh-speech-to-text-whisper <<<"
    assert.ok(install.includes(marcador), "bloco de inserção marcado")
    assert.ok(install.includes("dsh-speech-to-text-whisper"), "nome do pacote")
  })

  it("install.sh não tem caminho de usuário hardcoded", () => {
    assert.ok(!/\/home\/[a-z]+/.test(install), "só caminhos por env/HOME")
  })

  it("cordis.patch.yml registra o provider e desliga o SenseVoice", () => {
    assert.ok(cordis.includes("id: speech-to-text-whisper"))
    assert.ok(cordis.includes("defaultProvider: whisper-local"))
    assert.ok(cordis.includes("id: speech-to-text-sensevoice") && cordis.includes("disabled: true"))
  })
})

describe("lib/worker.js — correções de termos e idiomas", () => {
  const worker = readFileSync(join(pkg, "lib", "worker.js"), "utf8")

  it("tem a lista de correções determinísticas (editável)", () => {
    assert.ok(worker.includes("CORRECOES_NOMES"), "tabela presente")
    // Nenhum valor da tabela pode ter formato de nome próprio composto
    // (o vocabulário pessoal fica no dicionário do usuário, nunca no código).
    const valores = [...worker.matchAll(/CORRECOES_NOMES = \[([\s\S]*?)\]/g)]
      .flatMap(m => [...m[1].matchAll(/,\s*"([^"]+)"/g)].map(x => x[1]))
    for (const v of valores) {
      assert.ok(!/^[A-Z][a-zà-ú]+ [A-Z][a-zà-ú]+$/.test(v.trim()), `nome próprio suspeito: ${v}`)
    }
  })

  it("cobre português e os idiomas do Whisper", () => {
    assert.ok(worker.includes('"pt"'), "pt na lista de idiomas")
    assert.ok(worker.includes('"auto"'))
  })
})

describe("higiene geral do repositório", () => {
  for (const arq of ["install.sh", "ensure.sh", "uninstall.sh", "patch-index.py", "patch-decode.py"]) {
    it(`${arq}: sem caminhos de usuário nem segredos`, () => {
      const t = readFileSync(join(RAIZ, arq), "utf8")
      assert.ok(!/\/home\/[a-z]+/.test(t), "sem /home/<usuário>")
      assert.ok(!/(ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}/.test(t), "sem token")
    })
  }
})
