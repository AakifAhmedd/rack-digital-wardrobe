# RACK roadmap and to-do

## Roadmap numbering

The roadmap uses milestone labels such as 3.0 and 4.1. These are planning labels, not the app's `MAJOR.MINOR.PATCH` version in `VERSION`. Each completed milestone must still follow `VERSIONING.md`: bump the app version and include it in the same commit as the work.

When asked to build through a roadmap milestone, complete milestones in order. Finish and verify each milestone, then make a separate commit for it before starting the next. Push only when explicitly requested. Keep changes scoped to the milestone and preserve existing data and behavior.

## Version 3 — Complete wardrobe and bookshelf

The wardrobe remains RACK's primary feature. Version 3 completes its date tracking and introduces the Bookshelf as an optional, separate collection.

- **3.0 — Consistent wardrobe date tracking.** Record a date for every wear action, including quick wear logging. Make last-worn dates and wear history consistent across item edits, outfit logs, backups, restores, and sync. Existing date-aware flows should be consolidated and completed rather than duplicated.
- **3.1 — Wardrobe history and time-based insights.** Add practical views for recent and older wears and useful monthly summaries. Preserve perfume's separate collection behavior and its exclusion from clothing cost-per-wear averages.
- **3.2 — Wardrobe polish and reliability.** Review search, filters, mobile layouts, empty states, retirement, and backup/sync recovery. Complete the core wardrobe experience.
- **3.3 — Bookshelf foundation.** Add an optional Bookshelf alongside Wardrobe. Support adding, editing, searching, and archiving books, with title, author, fiction/non-fiction, genre, format, and reading status. Keep book records separate from wardrobe categories, activities, wear counts, outfits, and cost-per-wear.
- **3.4 — Reading history.** Record when books are started and finished and provide a per-book reading history.
- **3.5 — Collection management.** Add useful bookshelf sorting and filters, and practical states such as owned, borrowed, or wishlist where they fit the collection.
- **3.6 — Reading summaries.** Provide useful yearly or date-range reading summaries based on the recorded history. This completes the planned Bookshelf reading-history scope.
- **3.7–3.9 — Reserved.** Use these for focused improvements justified by use or compatibility needs. They are reserved milestones, not a reason to invent features.

## Version 4 — Images for wardrobe items

Make the wardrobe visual so item cards can show the actual T-shirt, pants, shoes, or accessory. Build on the existing perfume-photo implementation and keep items without photos fully supported.

- **4.0 — Wardrobe item photos.** Add optional photos for clothing, shoes, and accessories; show them on cards and item details.
- **4.1 — Photo framing and handling.** Improve framing, cropping, sizing, and practical controls for different item shapes.
- **4.2 — Visual browsing.** Make it easy to scan and filter the wardrobe visually while keeping text search useful.
- **4.3–4.9 — Reserved.** Use for focused visual-wardrobe refinements supported by real use.

Keep photos separate from ordinary wardrobe JSON, consistent with RACK's current photo-storage approach. Define compatible backup and sync behavior before changing it.

## Version 5 — Images for books

Add book-cover images after the Bookshelf collection and reading history are established.

- **5.0 — Book cover images.** Add optional cover images to books and display them in bookshelf cards and book details.
- **5.1 — Cover handling.** Refine portrait-cover sizing and provide a clear fallback when a cover is missing.
- **5.2 — Visual bookshelf browsing.** Support visual scanning alongside text search and useful filters.
- **5.3–5.9 — Reserved.** Use for focused bookshelf image improvements supported by real use.

Books without cover images must remain fully usable. Keep image storage and backup behavior compatible with the app's existing photo approach.

## Current to-do

### Under consideration

- **Cost-per-wear targets:** explore whether showing the additional wears needed to reach a target cost-per-wear is useful. This is an idea only, not a committed roadmap milestone.

### Completed

- **Outfit log:** “Wear this outfit” records selected item IDs and date/time alongside existing wear counts. Outfit history supports review and confirmed entry removal; the builder flags previously worn combinations. JSON/Gist snapshots include history under the existing whole-wardrobe conflict choice.
- **Perfume images:** the IndexedDB photo prototype, card display, zoom handling, manual backup, and explicit Gist Push/Pull transfer are implemented.

### Not planned

- Perfume millilitre visualisation.
- Further perfume-image work beyond maintenance of the existing implementation.
- Store.replaceAll backup validation as a separate project.
- Orphaned-photo pruning as a separate project.

## Existing product rules

- Fragrances never count toward cost-per-wear; they inflate the average.
- Preserve existing wardrobe, perfume, outfit, sync, and photo behavior while implementing roadmap milestones.
