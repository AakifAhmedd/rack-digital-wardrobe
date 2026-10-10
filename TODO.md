# RACK to-do

## Next planned work

- Outfit log: save the date and items when “Wear this outfit” is used, so repeated combinations can be avoided and outfit history can be viewed. This will change the synced data shape and needs an implementation review before work starts.

## Under consideration

- Cost-per-wear targets: explore whether showing the additional wears needed to reach a target cost-per-wear is useful. This is an idea only, not a committed task.

## Completed

- Perfume images: the IndexedDB photo prototype, card display, zoom handling, manual backup, and explicit Gist Push/Pull transfer are implemented.

## Not planned

- Perfume millilitre visualisation.
- Further perfume-image work beyond maintenance of the existing implementation.
- Store.replaceAll backup validation as a separate project.
- Orphaned-photo pruning as a separate project.
- The speculative Version 3 and Version 4 roadmap items from the previous list.

## Rules

- Fragrances never count toward cost-per-wear; they inflate the average.
