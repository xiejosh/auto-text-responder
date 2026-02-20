-- Get list of recent chat participants
on run
  set contactList to ""

  tell application "Messages"
    repeat with theChat in chats
      try
        repeat with thePart in participants of theChat
          set handle to handle of thePart as string
          set name to name of thePart as string
          set contactList to contactList & handle & "|||" & name & "~~~"
        end repeat
      end try
    end repeat
  end tell

  return contactList
end run
