import type { InteriorDefinition } from '../interior-layout'

/**
 * The default room exactly as it was hand-placed in pixels, before furniture
 * moved to grid positions with nudges. Frozen on purpose: the default layout
 * must keep resolving to precisely this, so the room never changes by accident.
 */
export const LEGACY_DEFAULT_ROOM: InteriorDefinition = {
  "id": "cozy-room",
  "widthPx": 256,
  "heightPx": 224,
  "wallHeightPx": 64,
  "style": {
    "floor": "floor",
    "wallUpper": "wallUpper",
    "wallLower": "wallLower"
  },
  "spawn": {
    "feetX": 132,
    "feetY": 100,
    "facing": "down"
  },
  "exit": {
    "id": "exit",
    "zone": {
      "x": 112,
      "y": 66,
      "w": 40,
      "h": 26
    },
    "promptX": 132,
    "promptY": 10
  },
  "pieces": [
    {
      "id": "door",
      "sprite": {
        "sheet": "kit",
        "name": "door"
      },
      "x": 116,
      "bottom": 64,
      "layer": "decor"
    },
    {
      "id": "window-blue",
      "sprite": {
        "sheet": "furniture",
        "name": "windowBlue"
      },
      "x": 12,
      "bottom": 50,
      "layer": "decor"
    },
    {
      "id": "window-pink",
      "sprite": {
        "sheet": "furniture",
        "name": "windowPink"
      },
      "x": 210,
      "bottom": 50,
      "layer": "decor"
    },
    {
      "id": "painting",
      "sprite": {
        "sheet": "furniture",
        "name": "paintingLandscape"
      },
      "x": 152,
      "bottom": 43,
      "layer": "decor"
    },
    {
      "id": "clock",
      "sprite": {
        "sheet": "furniture",
        "name": "clock"
      },
      "x": 192,
      "bottom": 40,
      "layer": "decor"
    },
    {
      "id": "rug",
      "sprite": {
        "sheet": "furniture",
        "name": "rugOrange"
      },
      "x": 60,
      "bottom": 197,
      "layer": "flat"
    },
    {
      "id": "bed",
      "sprite": {
        "sheet": "furniture",
        "name": "bedBlue"
      },
      "x": 12,
      "bottom": 124,
      "layer": "sorted",
      "solid": {
        "x": 12,
        "y": 64,
        "w": 30,
        "h": 60
      }
    },
    {
      "id": "chest",
      "sprite": {
        "sheet": "furniture",
        "name": "chest"
      },
      "x": 14,
      "bottom": 148,
      "layer": "sorted",
      "solid": {
        "x": 14,
        "y": 130,
        "w": 24,
        "h": 18
      }
    },
    {
      "id": "nightstand",
      "sprite": {
        "sheet": "furniture",
        "name": "nightstand"
      },
      "x": 44,
      "bottom": 100,
      "layer": "sorted",
      "solid": {
        "x": 44,
        "y": 76,
        "w": 26,
        "h": 24
      }
    },
    {
      "id": "lamp",
      "sprite": {
        "sheet": "furniture",
        "name": "lamp"
      },
      "x": 48,
      "bottom": 86,
      "layer": "sorted",
      "sortBottom": 100.2
    },
    {
      "id": "bookshelf",
      "sprite": {
        "sheet": "furniture",
        "name": "bookshelfTall"
      },
      "x": 60,
      "bottom": 72,
      "layer": "sorted",
      "solid": {
        "x": 60,
        "y": 64,
        "w": 48,
        "h": 8
      }
    },
    {
      "id": "plant-pink",
      "sprite": {
        "sheet": "furniture",
        "name": "plantPink"
      },
      "x": 162,
      "bottom": 86,
      "layer": "sorted",
      "solid": {
        "x": 162,
        "y": 64,
        "w": 19,
        "h": 22
      }
    },
    {
      "id": "computer-desk",
      "sprite": {
        "sheet": "prepared",
        "name": "computerDesk"
      },
      "x": 204,
      "bottom": 118,
      "layer": "sorted",
      "solid": {
        "x": 204,
        "y": 64,
        "w": 48,
        "h": 54
      },
      "role": "computer"
    },
    {
      "id": "table",
      "sprite": {
        "sheet": "furniture",
        "name": "plankTable"
      },
      "x": 176,
      "bottom": 190,
      "layer": "sorted",
      "solid": {
        "x": 176,
        "y": 140,
        "w": 64,
        "h": 50
      }
    },
    {
      "id": "notebook",
      "sprite": {
        "sheet": "prepared",
        "name": "notebook"
      },
      "x": 198,
      "bottom": 170,
      "layer": "sorted",
      "sortBottom": 190.2,
      "role": "notebook"
    },
    {
      "id": "books",
      "sprite": {
        "sheet": "prepared",
        "name": "bookStack"
      },
      "x": 182,
      "bottom": 168,
      "layer": "sorted",
      "sortBottom": 190.2
    },
    {
      "id": "chair",
      "sprite": {
        "sheet": "furniture",
        "name": "chair"
      },
      "x": 157,
      "bottom": 178,
      "layer": "sorted",
      "solid": {
        "x": 158,
        "y": 166,
        "w": 13,
        "h": 12
      }
    },
    {
      "id": "plant-green",
      "sprite": {
        "sheet": "furniture",
        "name": "plantGreen"
      },
      "x": 10,
      "bottom": 218,
      "layer": "sorted",
      "solid": {
        "x": 12,
        "y": 206,
        "w": 34,
        "h": 12
      }
    },
    {
      "id": "plant-red",
      "sprite": {
        "sheet": "furniture",
        "name": "plantRed"
      },
      "x": 234,
      "bottom": 218,
      "layer": "sorted",
      "solid": {
        "x": 234,
        "y": 208,
        "w": 14,
        "h": 10
      }
    }
  ]
}
