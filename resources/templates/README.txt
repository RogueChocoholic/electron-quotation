Templates that ship with the app
================================

Every .qtpl file in this folder is packed into the installer. After a PC updates to the
release, the app adds each of them to that PC's templates the first time it starts.
Nobody has to import anything.

How to ship a template
----------------------

1. In the app, open Templates, and on the template's card open the menu at its right
   edge and choose "Export to file".
2. Save or copy the .qtpl file into this folder.
3. Build and publish a release as usual (see docs\RELEASING.md).

What happens on each PC
-----------------------

- A file is added once. Starting the app again does not add it again.
- If the PC already has a template that looks exactly the same (for example the PC the
  template was made on), nothing is added.
- If someone deletes the template, it stays deleted, until a later release brings a
  changed file (see below), which is then added as a new template.
- If a later release brings a changed file with the same file name:
    - the template added from the earlier file is replaced, as long as nobody changed it;
    - if it was changed on that PC, it is left alone and the new one is added beside it.
- Removing a file from this folder does not remove the template from any PC.
- Quotations and invoices that were already made are never touched.

What a template file carries
----------------------------

The design, its texts and its images. Not the bank account: each PC shows the account
chosen in its own Settings.

Good to know
------------

- Keep the file name the same when you ship a newer version of the same template. A new
  file name is treated as a new template.
- The file name is not shown anywhere. The template gets the name it had when it was
  exported; if that name is taken, "(2)" is added.
- Only .qtpl files are read. Word files do not belong here: import them in the app
  (Templates -> Import), check the result, then export it as .qtpl.
- The app writes what it did to log.txt in the data folder of each PC
  (Settings -> Data folder -> Open folder).
