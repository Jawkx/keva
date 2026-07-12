# Vendored viewer boundary

The PDF and CSV implementations in `components/ui` are pinned Extend UI
registry copies. Review the upstream diff before replacing either file. Keva
code imports the typed adapters in this folder rather than vendored modules.
