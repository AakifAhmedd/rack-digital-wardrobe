# RACK to-do

## Next
- Cost-per-wear targets: show how many more wears an item needs to reach a target cost-per-wear.
- Outfit log: save the date and items when "Wear this outfit" is used, to avoid repeating combos and see what is worn together. Changes the synced data shape, so confirm before building.

## Not now
- Visualize the millilitres for perfumes.
- Work on images for perfumes.

## Way later
- Validate `Store.replaceAll` so restoring a bad backup file can't corrupt the live data.
- Prune orphaned photos from IndexedDB after a pull or restore removes items.

## Roadmap
- Version 3 (full release): date tracking and logging of wears, all clothes and perfumes logged, data exportable to map how the wardrobe is used.
- Version 4 (speculative): images built in, so cards show the actual item. Goes ahead only if the perfumes-only IndexedDB photo prototype works.

## Rules
- Fragrances never count toward cost-per-wear (they inflate the average).
