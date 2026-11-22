`roboto-text-layer.ttf` is Roboto Regular 2.137 (Google, Apache License 2.0,
https://www.apache.org/licenses/LICENSE-2.0), subset to Latin, Greek, Cyrillic,
punctuation, arrows and math operators. The PDF export uses it only for the invisible text
layer, so that text copied or searched in the PDF maps to the right characters. It is never drawn.

    python3 -m fontTools.subset Roboto-Regular.ttf \
      --unicodes="U+0020-007E,U+00A0-024F,U+0300-036F,U+0370-03FF,U+0400-04FF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2200-22FF" \
      --layout-features='' --no-hinting --output-file=roboto-text-layer.ttf
