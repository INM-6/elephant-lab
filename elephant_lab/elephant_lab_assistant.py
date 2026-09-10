from ipykernel.comm import Comm
import requests
from .config import API_KEY

class ChatCompletions():

    def __init__(self, api_key, model,temperature = 0.7, choices =  1, max_tokens =  100, user = 'default'):
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self.choices = choices
        self.max_tokens = max_tokens
        self.user = user
        self.headers = {'accept': 'application/json', 'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}

    url = "https://api.blablador.fz-juelich.de/v1/chat/completions"
   
    top_p =  1 # has something to do with temperature...
    presence_penalty = 0
    frequency_penalty = 0

    def get_completion(self, messages):
        payload = {
            "model": self.model,
            "messages": messages,
        }
        response = requests.post(url = self.url, headers = self.headers, json=payload)
        response.raise_for_status()
        return response.json()

comm = None
chat_completions = None

def create_assistant_comm():
    global comm
    comm = Comm(target_name="assistant_channel")
    global chat_completions
    chat_completions = ChatCompletions(api_key=API_KEY, model='alias-fast')

    comm.on_msg(
        lambda msg: handle_comm_message(msg)
    )

    return comm

def handle_comm_message(msg):
    try:
        data = msg["content"]["data"]

        match data.get("type"):
            case "user_message":
                handle_user_message(data.get("message"))
            case _:
                comm.send({"type": "error", "message": f'Undefined comm message data type: {data.get("type")}'})
    except Exception as e:
        comm.send({"type": "error", "message": str(e)})

def handle_user_message(msg):
    # do something
    response = chat_completions.get_completion([{"role":"user", "content":msg}])
    comm.send({
        'type': "assistant_response",
        'message': response['choices'][0]['message']['content']
    })

def close_assistant_comm():
    comm.close()