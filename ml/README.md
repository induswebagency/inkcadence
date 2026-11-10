# Inkcadence ML

## CharCNN (alphabet recognition)

Harvest used to fake labels by cycling letter frequency (`Q`→`a` style mix-ups).  
The browser now classifies each crop with a small CNN trained on **real human handwriting**:

| Source | Coverage |
|--------|----------|
| **EMNIST ByClass** (NIST writers) | Digits + A–Z + a–z, neat and messy |
| **Kaggle A–Z Handwritten Alphabets** | Extra uppercase variety |
| **Messy augmentations** | Blur, shear, thick/thin pen, noise, erasure, phone exposure |

### Train

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
# optional: pip install kagglehub
python ml/train_char_cnn.py
python ml/train_char_cnn.py --kaggle-download
python ml/train_char_cnn.py --quick
```

Place the Kaggle CSV at `ml/data/A_Z_Handwritten_Data.csv` if you already have it.

Outputs: `ml/artifacts/charcnn.pt`, `assets/charcnn.json`, `web/public/charcnn.json`.

### Browser

- `js/charcnn.js` — inference  
- `js/harvest.js` — `harvestFromPagesAsync()` labels with CharCNN  

### API

`POST /recognize` classifies base64 glyph crops when `charcnn.pt` is present.
