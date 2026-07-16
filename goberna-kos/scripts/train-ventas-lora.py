#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────
# LoRA fine-tuning: Goberna Ventas (CQ Engine → Qwen3-8B)
# Unsloth 4-bit + TRL SFTTrainer
# ─────────────────────────────────────────────────────────

import json
import os

from unsloth import FastLanguageModel, PatchFastRL
from datasets import Dataset
from trl import SFTConfig, SFTTrainer
import torch

# ── Config ──────────────────────────────────────────────
MODEL_ID = os.path.expanduser("~/models/qwen3-8b-unsloth-bnb-4bit")
MAX_SEQ_LEN = 2048
DTYPE = None  # None = auto-detect

DATASET_PATH = os.path.expanduser("~/ia-local/datasets/lora-ventas.jsonl")
OUTPUT_DIR = os.path.expanduser("~/ia-local/lora-outputs/ventas-v1")

# ── Cargar modelo 4-bit ─────────────────────────────────
print("🦥 Cargando modelo base:", MODEL_ID)
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_ID,
    max_seq_length=MAX_SEQ_LEN,
    dtype=DTYPE,
    load_in_4bit=True,
)

# ── Aplicar LoRA ───────────────────────────────────────
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    lora_alpha=16,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=3407,
    use_rslora=False,
)

# ── Cargar dataset ─────────────────────────────────────
print("📚 Cargando dataset:", DATASET_PATH)
rows = []
with open(DATASET_PATH, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line:
            rows.append(json.loads(line))

dataset = Dataset.from_list(rows)

# ── Config de entrenamiento ────────────────────────────
training_args = SFTConfig(
    per_device_train_batch_size=1,
    gradient_accumulation_steps=4,
    warmup_ratio=0.1,
    num_train_epochs=3,
    learning_rate=2e-4,
    fp16=not torch.cuda.is_bf16_supported(),
    bf16=torch.cuda.is_bf16_supported(),
    logging_steps=1,
    optim="adamw_8bit",
    weight_decay=0.01,
    lr_scheduler_type="linear",
    seed=3407,
    output_dir=OUTPUT_DIR,
    report_to="none",
    save_strategy="epoch",
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="messages",
    max_seq_length=MAX_SEQ_LEN,
    args=training_args,
)

# ── Entrenar ───────────────────────────────────────────
print("🚀 Iniciando entrenamiento...")
trainer.train()

# ── Guardar ───────────────────────────────────────────
print("💾 Guardando LoRA en:", OUTPUT_DIR)
model.save_pretrained(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)

# También exportar a GGUF para Ollama/llama.cpp
print("📦 Exportando a GGUF...")
model.save_pretrained_gguf(OUTPUT_DIR + "/gguf", tokenizer)

print("✅ Listo.")
