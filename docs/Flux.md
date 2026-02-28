# Flux - Field Level Universal Transformer

The aim of this tool is to provide non technical users (HR consultants) with an interface to aid in Data Migration between systems (Our first example is SAP SF to WorkDay but could be others as well in the future). 

The main objective is to create an easy to configure ETL like experience allowing for multiple functionalities i will now define. The tool is not connected directly to the source system (i.e. Sap SF) or the target (i.e. WorkDay) but rather just prepares files for the systems to communicate.

## Source Data Files upload

The tool should provide an interface to allow the user to upload multiple excel files, provide schema inference, create objects with a defined schema and with some metadata to identify the object (name, type of data, etc). The user should be able to edit metadata of the object and the schema in any moment. The schema should allow for the most common data types (String, Integer, Float, Date, Datetime etc...) plus PickList which are essentially foreign keys to other files. This way, all the metadata from the source system tables should be mapped in the application and ready for the transformation phase.

!!! TIP: We could work with a Factory approach to the source data files upload/metadata loading to allow in the future for a direct connection with systems if possible, providing basically a middleware mode that does not require user downloading data from the source and uploading transformed data to the target

!!! TIP: We could think about having a section for source picklists separated from the data files since i assume picklists will be used in different places. Also it's mandatory to enable bulk upload of files (i.e. all the picklists, all the excels) as well as single file uploads

## Target Template uploads

The target files will have defined schemas and the target system will have it's own picklists. What we need in the target template section is a way to define the structure of the target files or upload excel templates that will represent the target objects. The object will be the same type as the source objects, with schema and metadata similar to the source items and editable the same way. Target will also have it's how picklists and can have picklist type columns.

## Picklist mapping

There will be a section of the tool to allow the user to build mappings between the picklists allowing for an automatic translation during the transform phase

## Transformations definitions

The tool must provide a section that allows for the definition of mappings between object. A nice to have would be to have a graphical tool to do so with drag and drop, arrows and so on (talend is an inspiration for this). The final solution should allow for the following operations:

    * 1:1 mappings: The source object maps to only one target object. Source columns are transformed to populate target columns.
    * 1:many mappings: One single source item is split over multiple target files. This should act like the 1:1 mapping
    * many:1 mappings: More than one sources are put in join before mapping to the target, this could be done using a join operation before
    * many:many mappings: everything goes everywhere but basically it's a merge of 1:many and many:1 approaches, not that crazy

The transformations should be easy but customizable. What we tought so far are:

* Copy value as is
* Concatenate either with fixed value or two columns
* Split columns
* Substring on column
* Change date format
* Translate picklist from soruce to target (see previous section)
* Perform a lookup operation (this maybe can be avoided using a join first)
* UUID generation
* Incremental values
* Fixed values

The more the merrier, the sky is the limit here i guess.

## UX/UI

What I envision is a tool that presents itself to the user with a project selection page, the user can see all the projects he already created and choose either to work on one or create a new one.

Each project has the sections we described before:
* Sources: Card based interface split in two parts, one for the sources and one for the picklists. The user can edit items or create new ones. The interaction with a card should open a dedicated details overlay to keep the interface cleaner. This should allow for massive imports in either of the sections.
* Target: Basically the same as sources
* Picklist mapping: Cards here as well could work providing a way to map source picklist with target picklist. This could be done massively as well with an excel maybe and uploaded.
* Transformations definition: The interface for the graphical etl construction

There should be a run button as well to start the transformation. Projects should be deletable too, project names should be editable and so on.

## Tech stack

It's your job to determine the best tech stack to build this, our only mandatory requirement is that this will be used as a standalone product. What I think is mandatory is a lightweight database to incorporate in the app that will act both as operatonal database for the application and to store the data that will be transformed by the user.

## Future evolution, nice to have

Aided mapping would be a nice feature, providing the user with some standard mappings for well known objects that stay the same even between different SF/WorkDay environments.