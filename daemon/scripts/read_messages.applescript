-- Read messages from the last N minutes
-- Usage: osascript read_messages.applescript <minutes>
on run argv
  set minutesBack to (item 1 of argv) as integer
  set cutoffTime to (current date) - (minutesBack * minutes)

  set messageList to {}

  tell application "Messages"
    repeat with theChat in chats
      try
        repeat with theMessage in messages of theChat
          if date of theMessage > cutoffTime then
            if direction of theMessage is incoming then
              set msgData to {|id|:(id of theMessage as string), |body|:(content of theMessage), |handle|:(handle of sender of theMessage as string), |chatId|:(id of theChat as string), |timestamp|:(date of theMessage as string)}
              set end of messageList to msgData
            end if
          end if
        end repeat
      end try
    end repeat
  end tell

  -- Convert to delimited string for parsing
  set output to ""
  repeat with msg in messageList
    set output to output & (|id| of msg) & "|||" & (|body| of msg) & "|||" & (|handle| of msg) & "|||" & (|chatId| of msg) & "|||" & (|timestamp| of msg) & "~~~"
  end repeat

  return output
end run
