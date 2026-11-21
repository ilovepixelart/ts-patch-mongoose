import Base

# What a history entry carries beside its document (src/patch.ts). modelName and collectionName are
# the plugin option when it is set and the model's otherwise. user, reason and metadata come from the
# getters, each settled on its own: a value, null included, is stored; undefined, a throw or a
# rejection stores nothing, and never stops the entry or the other getters.

type Outcome is Data:
  Value{v: Nat}
  Null{}
  Undefined{}
  Failed{}

type Field is Data:
  FValue{v: Nat}
  FNull{}

def field(o: Outcome) -> Maybe<Field>:
  match o:
    case Value{v}:
      Some{FValue{v}}
    case Null{}:
      Some{FNull{}}
    case Undefined{}:
      None{}
    case Failed{}:
      None{}

def name(option: Maybe<Nat>, model: Nat) -> Nat:
  match option:
    case None{}:
      model
    case Some{n}:
      n

