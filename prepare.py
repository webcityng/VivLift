"""
VivLift web - run ONCE on a computer WITH internet (needs only Python 3, nothing to install).

It downloads into this folder:
  lib/     the speech-engine library (Transformers.js) and its WebAssembly files
  models/  the Whisper "base.en" speech model (quantised, about 75 MB)

Then upload the WHOLE folder to any HTTPS web host. Visitors never contact any other site.
"""
import io, os, sys, tarfile, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, "lib")
MODEL = os.path.join(HERE, "models", "Xenova", "whisper-base.en")
NPM = "https://registry.npmjs.org/{pkg}/-/{name}-{ver}.tgz"
HF = "https://huggingface.co/Xenova/whisper-base.en/resolve/main/{f}"

REQUIRED = ["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json",
            "tokenizer_config.json", "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"]
OPTIONAL = ["special_tokens_map.json", "added_tokens.json", "vocab.json", "merges.txt", "normalizer.json"]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "VivLift-prepare"})
    with urllib.request.urlopen(req) as r:
        return r.read()


def npm_extract(pkg, name, ver, wanted):
    data = get(NPM.format(pkg=pkg, name=name, ver=ver))
    got = []
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
        for m in t.getmembers():
            base = os.path.basename(m.name)
            if m.isfile() and "/dist/" in m.name and wanted(base):
                with open(os.path.join(LIB, base), "wb") as f:
                    f.write(t.extractfile(m).read())
                got.append(base)
    return got


os.makedirs(LIB, exist_ok=True)
print("1/3  Speech-engine library (Transformers.js 2.17.2)...")
got = npm_extract("@xenova/transformers", "transformers", "2.17.2", lambda b: b == "transformers.min.js" or b.endswith(".wasm"))
if not any(g.endswith(".wasm") for g in got):
    print("     WebAssembly files were not in that package; fetching them from onnxruntime-web 1.14.0...")
    got += npm_extract("onnxruntime-web", "onnxruntime-web", "1.14.0", lambda b: b.endswith(".wasm"))
print("     saved:", ", ".join(sorted(got)))

print("2/3  Whisper base.en model files...")
for f in REQUIRED + OPTIONAL:
    dest = os.path.join(MODEL, *f.split("/"))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        print("     ", f, end=" ... ", flush=True)
        data = get(HF.format(f=f))
        open(dest, "wb").write(data)
        print(f"{len(data) / 1e6:.1f} MB")
    except urllib.error.HTTPError as e:
        if f in OPTIONAL:
            print("not present (fine)")
        else:
            sys.exit(f"\nFAILED: {f} ({e}). Check your internet connection and run again.")

print("3/3  Checking...")
need = [os.path.join(LIB, "transformers.min.js")] + [os.path.join(MODEL, *f.split("/")) for f in REQUIRED]
missing = [p for p in need if not os.path.isfile(p)]
if missing or not any(n.endswith(".wasm") for n in os.listdir(LIB)):
    sys.exit("Something is missing: " + ", ".join(missing))
print("All set. Upload this whole folder to your HTTPS web host.")
print("To test on this computer first:  python -m http.server 8000   then open http://localhost:8000")
