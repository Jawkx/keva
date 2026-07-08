import { useState } from "react";
import { ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

export function PasswordInput(props: React.ComponentProps<typeof InputGroupInput>) {
  const [show, setShow] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput {...props} type={show ? "text" : "password"} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={show ? "Hide password" : "Show password"}
          onClick={() => setShow((s) => !s)}
        >
          {show ? <HugeiconsIcon icon={ViewOffIcon} /> : <HugeiconsIcon icon={ViewIcon} />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
