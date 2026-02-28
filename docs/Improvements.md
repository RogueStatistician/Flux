# Feedbacks

* We need to have the ability to edit the source and target objects loaded in Flux, we need to edit schema after the object is created. Maybe this could be locked behind an edit button when inspecting the objects
* For the sources and target we need to be able to hide field from source or target we don't need to map. Maybe the graphical approach has to be reviewd a bit, we could have operators to add in the lineage graph to allow the user for a more precise handling of the mappings such as:
    * Join: We can join two data sources together defining a join key, this way we can populate a target using data coming from two different sources
    * Map: We have a different view with source fields, mapping operations and target fields. The map operator must be linked with sources (either one source or one join) and a target and could be cleaner compared to the current implementation of the mapping rules. This should allow for target mapping with constants/generated values not requiring a source
    * Filter: We could add a way to filter the source data before passing it to the target
* Remove all instances of autofill or any other automatic operation, let's make HR consultants work
* We need to ask for the separator when loading a CSV, this is mandatory because if not asked it could lead to wrong imports. Default is comma but make it editable when creating the object
* Remove the display name from the schemas and add a description field that will be populated by the user. This should be displayed in the preview of the source as tooltip and in the mapping
* For excels, we need to pay attention for sap files that could contain two header rows
* When a field is mapped as picklist we need to reference which picklist it's pointing to